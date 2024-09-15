import { Request, Response } from "express";
import { Socket } from "socket.io";
import express from 'express';
import http from 'http';
import { Server as SocketIOServer } from 'socket.io';
import cors from 'cors';
import Queue from 'bull';

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
        credentials: false // Allow credentials (cookies, authorization headers) do we need this??
    }
});

const SERVE_TIME_PER_PERSON = 3 * 1000;
const TOTAL_SEATS = 10;
// socket.io rooms are not working. This is the workaround
// todo: replace with a LRU cache
const socketMap: { [key: string]: Socket[] } = {};

const seatQueue = Queue('seating');

initRedis()
    .then(getAllCustomersFromRedis)
    .then((customers: Customer[]) => {
        // recalculate number of seated people upon app start up,
        // in case availableSeats and customers get out of sync
        return customers.reduce((seated: number, c: Customer) => {
            if (c.status === 'seated') {
                return seated + c.partySize;
            } else {
                return seated;
            }
        }, 0)
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
 * Maps socket to a customerId so we know which socket to inform when table is ready
 */
io.on('connection', (socket: Socket) => {
    socket.on('setCustomerId', (data: { customerId: number }) => {
        const sockets = (socketMap[data.customerId.toString()] || []) as Socket[];
        sockets.push(socket);
        socketMap[data.customerId.toString()] = sockets;
    });
});

/**
 * Fetches customer details. Sent when client does a page refresh
 * 
 */
app.get('/api/customers/:id', async (req: Request, res: Response) => {
    const { id } = req.params;

    const customer = await getCustomerFromRedis(id);
    const cachedCustomers = await getAllCustomersFromRedis();
    const availableSeats = await getAvailableSeats()

    if (customer && availableSeats) {
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
    } else if (availableSeats) {
        console.log('No customer found');
        res.status(404).json({ message: 'Customer not found' });
    } else {
        console.error(`Error in fetching availableSeats in the server`);
        res.status(500).json({ message: `Error in fetching availableSeats in the server`});
    }
});

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
 * Handles when a new customer joins
 */
app.post('/api/customers', async (req: Request, res: Response) => {

    const availableSeats = await getAvailableSeats()

    if (availableSeats === null) {
        console.error(`Error in fetching availableSeats in the server`);
        res.status(500).json({ message: `Error in fetching availableSeats in the server`});
        return;
    }

    const { name, partySize } = req.body;

    if (partySize > TOTAL_SEATS) {
        res.status(400).json({
            message: `Sorry. We cannot take groups larger than ${TOTAL_SEATS} people`
        });
        return;
    }

    const newCustomer : Customer = {
        id: await getNextCustomerId(),
        name,
        partySize,
        status: 'waiting'
    };

    // this will do a parse on all the customers, maybe there is a more efficient way
    const customers = await getAllCustomersFromRedis();
    const position = customers.filter(inQueue).length;

    // currently there are 2 places where we set tableReady. Maybe this is not good
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

app.put('/api/customers/:id/check-in', async (req: Request, res: Response) => {
    const id = req.params?.id;
    const customer = await getCustomerFromRedis(id);

    let availableSeats = await getAvailableSeats();

    if (availableSeats === null) {
        console.error(`Error in fetching availableSeats in the server`);
        res.status(500).json({ message: `Error in fetching availableSeats in the server`});
        return;
    }

    if (customer?.status === 'tableReady' && customer.partySize <= availableSeats) {
        customer.status = 'seated';
        availableSeats -= customer.partySize;
        await setAvailableSeats(availableSeats);

        await addCustomerToRedis(customer);

        console.log(`Seating customer ${id}. Available seats now: ${availableSeats}`);
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
 * Handles when customer finishes eating. We seat the next customer
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

        // notify next awaiting customer
        try {
            const customers = await getAllCustomersFromRedis()
            const nextCustomer = customers.find((c: Customer) => c.status === 'waiting');

            // fetch availableSeats again to make sure we have the most up-to-date data
            availableSeats = await getAvailableSeats();
            if (availableSeats === null) {
                console.error(`Error in fetching availableSeats in the server`);
                throw Error(`Error in fetching availableSeats in the server`);
            }

            if (nextCustomer && nextCustomer.partySize <= availableSeats) {
                nextCustomer.status = 'tableReady';
                await addCustomerToRedis(nextCustomer);

                const socket = socketMap[nextCustomer.id.toString()].find(c => c.connected);
                if (socket) {
                    console.log(`Found next customer ${nextCustomer.id} and corresponding socket. Emitting tableReady event`);
                    socket.emit('tableReady');
                } else {
                    console.log(`Found next customer ${nextCustomer.id} but cannot find corresponding socket`);
                }
                delete socketMap[nextCustomer.id.toString()];
            }
        } catch (err) {
            console.error(`Failed to get the next customer to sit`);
        }
    }
})

function inQueue(c: Customer) {
    return c.status === 'waiting' || c.status === 'tableReady';
}

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});