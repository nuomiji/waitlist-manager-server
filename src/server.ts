import { Request, Response } from "express";
import { Socket } from "socket.io";
import express from 'express';
import http from 'http';
import { Server as SocketIOServer } from 'socket.io';
import cors from 'cors';
import Queue from 'bull';
import { createAdapter } from '@socket.io/redis-adapter';
import { createClient } from 'redis';

import {
    initRedis,
    addCustomerToRedis,
    deleteCustomerFromRedis,
    getCustomerFromRedis,
    getAllCustomersFromRedis,
    getNextCustomerId,
    getAvailableSeats,
    setAvailableSeats,
} from './redis-helpers';

import { Customer } from './types';

const app = express();
const server = http.createServer(app);
const io = new SocketIOServer(server, {
    cors: {
        origin: 'http://localhost:3000',
        methods: ['GET', 'POST'],
        credentials: false
    }
});

// Set up Redis clients for the Socket.io adapter
const pubClient = createClient({ url: 'redis://localhost:6379' });
const subClient = pubClient.duplicate();
pubClient.connect();
subClient.connect();

// Attach the Redis adapter to Socket.io for multi-instance communication
io.adapter(createAdapter(pubClient, subClient));

const SERVE_TIME_PER_PERSON = 3 * 1000;
const TOTAL_SEATS = 10;

const seatQueue = Queue('seating', {
    redis: {
        host: 'localhost',
        port: 6379,
    }
});

/**
 * Initializes Redis and updates available seats based on the current customer data.
 */
initRedis()
    .then(getAllCustomersFromRedis)
    .then((customers: Customer[]) => {
        // Recalculate number of seated people upon app start up
        return customers.reduce((seated: number, c: Customer) => {
            if (c.status === 'seated') {
                return seated + c.partySize;
            } else {
                return seated;
            }
        }, 0);
    })
    .then((seated: number) => {
        console.log(`setting availableSeats to ${TOTAL_SEATS - seated}`);
        setAvailableSeats(TOTAL_SEATS - seated); // note this is async
    })
    .catch((err: Error) => {
        console.error(err);
    });

app.use(cors());
app.use(express.json());

/**
 * Maps socket to a customerId so we know which socket to inform when the table is ready.
 * @param {Socket} socket The connected socket instance
 */
io.on('connection', (socket: Socket) => {
    /**
     * Associates a customer ID with the socket connection
     * @param {Object} data - Contains the customerId.
     * @param {number} data.customerId - The customer ID to associate with the socket.
     */
    socket.on('setCustomerId', (data: { customerId: number }) => {
        socket.join(data.customerId.toString());
    });
});

/**
 * Fetches customer details, including their queue position and seating status.
 * @route GET /api/customers/:id
 * @param {Request} req - Express request object
 * @param {Response} res - Express response object
 */
app.get('/api/customers/:id', async (req: Request, res: Response) => {
    const { id } = req.params;

    const customer = await getCustomerFromRedis(id);
    const cachedCustomers = await getAllCustomersFromRedis();
    const availableSeats = await getAvailableSeats();

    if (customer && availableSeats !== null) {
        const position = cachedCustomers.filter((c: Customer) => inQueue(c) && c.id < customer.id).length;

        if (position === 0 && customer.status === 'waiting' && customer.partySize <= availableSeats) {
            customer.status = 'tableReady';
            await addCustomerToRedis(customer);
        }

        res.json({
            id: customer.id,
            name: customer.name,
            partySize: customer.partySize,
            status: customer.status,
            position
        });
    } else if (availableSeats !== null) {
        console.log('No customer found');
        res.status(404).json({ message: 'Customer not found' });
    } else {
        console.error(`Error in fetching availableSeats in the server`);
        res.status(500).json({ message: `Error in fetching availableSeats in the server` });
    }
});

/**
 * Deletes a customer from the system.
 * @route DELETE /api/customers/:id
 * @param {Request} req - Express request object
 * @param {Response} res - Express response object
 */
app.delete('/api/customers/:id', async (req: Request, res: Response) => {
    const { id } = req.params;

    try {
        await deleteCustomerFromRedis(id);
        res.sendStatus(204);
    } catch (err) {
        console.error(`Failed to delete customer from redis`);
        res.sendStatus(500);
    }
});

/**
 * Adds a new customer to the queue.
 * @route POST /api/customers
 * @param {Request} req - Express request object containing customer name and party size
 * @param {Response} res - Express response object
 */
app.post('/api/customers', async (req: Request, res: Response) => {

    const availableSeats = await getAvailableSeats();

    if (availableSeats === null) {
        console.error(`Error in fetching availableSeats in the server`);
        res.status(500).json({ message: `Error in fetching availableSeats in the server` });
        return;
    }

    const { name, partySize } = req.body;

    if (partySize > TOTAL_SEATS) {
        res.status(400).json({
            message: `Sorry. We cannot take groups larger than ${TOTAL_SEATS} people`
        });
        return;
    }

    const newCustomer: Customer = {
        id: await getNextCustomerId(),
        name,
        partySize,
        status: 'waiting'
    };

    const customers = await getAllCustomersFromRedis();
    const position = customers.filter(inQueue).length;

    if (position === 0 && newCustomer.partySize <= availableSeats) {
        newCustomer.status = 'tableReady';
    }

    await addCustomerToRedis(newCustomer);

    res.json({
        id: newCustomer.id,
        name: newCustomer.name,
        partySize: newCustomer.partySize,
        status: newCustomer.status,
        position
    });
});

/**
 * Checks in a customer, seating them if their table is ready.
 * @route PUT /api/customers/:id/check-in
 * @param {Request} req - Express request object containing the customer ID
 * @param {Response} res - Express response object
 */
app.put('/api/customers/:id/check-in', async (req: Request, res: Response) => {
    const id = req.params?.id;
    const customer = await getCustomerFromRedis(id);

    let availableSeats = await getAvailableSeats();

    if (availableSeats === null) {
        console.error(`Error in fetching availableSeats in the server`);
        res.status(500).json({ message: `Error in fetching availableSeats in the server` });
        return;
    }

    if (customer?.status === 'tableReady' && customer.partySize <= availableSeats) {
        customer.status = 'seated';
        availableSeats -= customer.partySize;
        await setAvailableSeats(availableSeats);

        await addCustomerToRedis(customer);

        console.log(`Seating customer ${id}. There are ${availableSeats} seats available`);
        seatQueue.add({ customerId: id }, {
            delay: customer.partySize * SERVE_TIME_PER_PERSON,
            removeOnComplete: true
        });
        res.json({ message: `Customer ${id} checked in and seated` });
    } else {
        res.status(404).json({ message: 'Customer not ready or already seated' });
    }
});

/**
 * Processes the completion of a customer's dining session and notifies the next waiting customer.
 * @param {Object} job - Bull job containing the customerId
 */
seatQueue.process(async (job: { data: { customerId: string } }) => {
    const { customerId } = job.data;
    const customer = await getCustomerFromRedis(customerId);
    let availableSeats = await getAvailableSeats();

    if (availableSeats === null) {
        console.error(`Error in fetching availableSeats in the server`);
        throw Error(`Error in fetching availableSeats in the server`);
    }

    if (customer) {
        await deleteCustomerFromRedis(customerId);

        availableSeats += customer.partySize;
        await setAvailableSeats(availableSeats);
        console.log(`Customer ${customer.id} finished dining and are leaving the restaurant. Available seats now: ${availableSeats}`);

        try {
            const customers = await getAllCustomersFromRedis();
            const nextCustomer = customers.find((c: Customer) => c.status === 'waiting');

            availableSeats = await getAvailableSeats();
            if (availableSeats === null) {
                console.error(`Error in fetching availableSeats in the server`);
                throw Error(`Error in fetching availableSeats in the server`);
            }

            if (nextCustomer && nextCustomer.partySize <= availableSeats) {
                nextCustomer.status = 'tableReady';
                await addCustomerToRedis(nextCustomer);

                io.to(nextCustomer.id.toString()).emit('tableReady');
                console.log(`Notified customer ${nextCustomer.id} that their table is ready`);
            }
        } catch (err) {
            console.error(`Failed to get the next customer to sit`);
        }
    }
});

/**
 * Determines if a customer is still in the queue (either waiting or tableReady).
 * @param {Customer} c - The customer object.
 * @returns {boolean} - True if the customer is in the queue, otherwise false.
 */
function inQueue(c: Customer): boolean {
    return c.status === 'waiting' || c.status === 'tableReady';
}

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
