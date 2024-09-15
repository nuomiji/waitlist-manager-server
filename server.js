const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const Queue = require('bull');

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
const socketMap = {};

// in-mem for now. Will update to something per persistent
const customers = [];
const seatQueue = Queue('seating');
// todo: add lock for running on multiple instances
let availableSeats = TOTAL_SEATS;

app.use(cors());
app.use(express.json());

/**
 * Maps socket to a customerId so we know which socket to inform when table is ready
 */
io.on('connection', (socket) => {
    socket.on('setCustomerId', (data) => {
        // console.log(`Socket ${socket.id} mapped to ${data.customerId}`);
        const sockets = (socketMap[data.customerId.toString()] || []);
        sockets.push(socket);
        socketMap[data.customerId.toString()] = sockets;
    });
});

/**
 * Fetches customer details. Sent when client does a page refresh
 * 
 */
app.get('/api/customers/:id', (req, res) => {
    const { id } = req.params;
    
    // need to implement a better way to retrieve customer when we implement data store
    const customer = customers.find(c => c.id == id);

    if (customer) {
        const position = customers.filter(c => inQueue(c) && c.id < customer.id).length;

        if (position === 0 && customer.status === 'waiting' && customer.partySize <= availableSeats) {
            customer.status = 'tableReady';
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
        res.status(404).json({ message: 'Customer not found'});
    }
});

/**
 * Handles when a new customer joins
 */
app.post('/api/customers', (req, res) => {

    const { name, partySize } = req.body;

    if (partySize > TOTAL_SEATS) {
        res.status(400).json({
            message: `Sorry. We cannot take groups larger than ${TOTAL_SEATS} people`
        });
        return;
    }
    
    const newCustomer = {
        id: customers.length + 1,
        name,
        partySize,
        status: 'waiting'
    };

    customers.push(newCustomer);

    // calculate position. we might need another algorithm in the future
    const position = customers.filter(inQueue).length - 1;

    // currently there are 2 places where we set tableReady. Maybe this is not good
    if (position === 0 && newCustomer.partySize <= availableSeats) {
        newCustomer.status = 'tableReady';
    }

    res.json({
        id: newCustomer.id,
        name: newCustomer.name,
        partySize: newCustomer.partySize,
        status: newCustomer.status,
        position
    });
});

app.put('/api/customers/:id/check-in', (req, res) => {
    const id = Number(req.params?.id);
    const customer = customers.find(c => c.id === id);

    if (customer?.status === 'tableReady' && customer.partySize <= availableSeats) {
        customer.status = 'seated';
        availableSeats -= customer.partySize;
        console.log(`Seating customer ${id}. Available seats now: ${availableSeats}`);
        seatQueue.add({ customerId: id }, {
            delay: customer.partySize * SERVE_TIME_PER_PERSON,
            removeOnComplete: true
        });
        res.json({ message: `Customer ${id} checked in and seated`});
    } else {
        res.status(404).json({ message: 'Customer not ready or already seated'});
    }
});

/**
 * Handles when customer finishes eating. We seat the next customer
 */
seatQueue.process(async (job) => {
    const { customerId } = job.data;
    const customer = customers.find(c => c.id == customerId); // todo: need to check if id is string or number
    
    if (customer) {
        customer.status = 'done';
        availableSeats += customer.partySize; 
        console.log(`Customer ${customer.id} finished dining and are leaving the restaurant. Available seats now: ${availableSeats}`);
        
        // notify next awaiting customer
        const nextCustomer = customers.find(c => c.status === 'waiting');
        if (nextCustomer && nextCustomer.partySize <= availableSeats) {
            nextCustomer.status = 'tableReady';
            
            const socket = socketMap[nextCustomer.id.toString()].find(c => c.connected);
            if (socket) {
                console.log(`Found next customer ${nextCustomer.id} and corresponding socket. Emitting tableReady event`);
                socket.emit('tableReady');
            } else {
                console.log(`Found next customer ${nextCustomer.id} but cannot find corresponding socket`);
            }
            delete socketMap[nextCustomer.id.toString()];
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