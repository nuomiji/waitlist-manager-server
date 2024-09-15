const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const Queue = require('bull');
const {
    initRedis,
    addCustomerToRedis,
    deleteCustomerFromRedis,
    getCustomerFromRedis,
    getAllCustomersFromRedis,
    getNextCustomerId,
    getAvailableSeats,
    setAvailableSeats,
} = require('./redis-helpers');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: 'http://localhost:3000',
        methods: ['GET', 'POST'], // what is this???
        allowedHeaders: ['my-custom-header'], // what is this???
        credentials: true // Allow credentials (cookies, authorization headers) do we need this??
    }
});

const SERVE_TIME_PER_PERSON = 3 * 1000;
const TOTAL_SEATS = 10;
// socket.io rooms are not working. This is the workaround
// todo: replace with a LRU cache
const socketMap = {};

const seatQueue = Queue('seating');

initRedis()
    .then(() => {
        console.log(`setting availableSeats to ${TOTAL_SEATS}`);
        return setAvailableSeats(TOTAL_SEATS); // note that this async
    })
    .catch(err => {
        console.error(err);
    })


app.use(cors());
app.use(express.json());

/**
 * Maps socket to a customerId so we know which socket to inform when table is ready
 */
io.on('connection', (socket) => {
    socket.on('setCustomerId', (data) => {
        const sockets = (socketMap[data.customerId.toString()] || []);
        sockets.push(socket);
        socketMap[data.customerId.toString()] = sockets;
    });
});

/**
 * Fetches customer details. Sent when client does a page refresh
 * 
 */
app.get('/api/customers/:id', async (req, res) => {
    const { id } = req.params;

    const customer = await getCustomerFromRedis(id);
    const cachedCustomers = await getAllCustomersFromRedis();

    if (customer) {
        const position = cachedCustomers.filter(c => inQueue(c) && c.id < customer.id).length;

        if (position === 0 && customer.status === 'waiting' && customer.partySize <= await getAvailableSeats()) {
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
    } else {
        console.log('No customer found');
        res.status(404).json({ message: 'Customer not found' });
    }
});

app.delete('/api/customers/:id', async (req, res) => {
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
app.post('/api/customers', async (req, res) => {

    const { name, partySize } = req.body;

    if (partySize > TOTAL_SEATS) {
        res.status(400).json({
            message: `Sorry. We cannot take groups larger than ${TOTAL_SEATS} people`
        });
        return;
    }

    const newCustomer = {
        id: await getNextCustomerId(),
        name,
        partySize,
        status: 'waiting'
    };

    // this will do a parse on all the customers, maybe there is a more efficient way
    const customers = await getAllCustomersFromRedis();
    const position = customers.filter(inQueue).length;

    // currently there are 2 places where we set tableReady. Maybe this is not good
    if (position === 0 && newCustomer.partySize <= await getAvailableSeats()) {
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

app.put('/api/customers/:id/check-in', async (req, res) => {
    const id = Number(req.params?.id);
    const customer = await getCustomerFromRedis(id);

    let availableSeats = await getAvailableSeats();
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
seatQueue.process(async (job) => {
    const { customerId } = job.data;
    const customer = await getCustomerFromRedis(customerId);

    if (customer) {
        await deleteCustomerFromRedis(customerId);

        let availableSeats = await getAvailableSeats();
        availableSeats += customer.partySize;
        await setAvailableSeats(availableSeats);
        console.log(`Customer ${customer.id} finished dining and are leaving the restaurant. Available seats now: ${availableSeats}`);

        // notify next awaiting customer
        try {
            const customers = await getAllCustomersFromRedis()
            const nextCustomer = customers.find(c => c.status === 'waiting');

            // fetch availableSeats again to make sure we have the most up-to-date data
            availableSeats = await getAvailableSeats();
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

function inQueue(c) {
    return c.status === 'waiting' || c.status === 'tableReady';
}

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});