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

// in-mem for now. Will update to something per persistent
const customers = [];
const seatQueue = Queue('seating');

app.use(cors());
app.use(express.json());

/**
 * Maps socket to a customerId so we know which socket to inform when table is ready
 */
io.on('connection', (socket) => {
    socket.on('setCustomerId', (data) => {
        console.log(`Socket ${socket.id} joined room ${data.customerId}`);
        socket.join(data.customerId);
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

        // this is a wordaround. currently this is only updated when a client fetches details
        // we will need to trigger this on server side in the future
        if (position === 0 && customer.status === 'waiting') {
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
    if (position === 0) {
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

    if (customer?.status === 'tableReady') {
        customer.status = 'seated';
        // todo: deduct avaible seats
        console.log(`Seating customer ${id}`);
        seatQueue.add({ customerId: id }, { delay: customer.partySize * SERVE_TIME_PER_PERSON});
        res.json({ message: `Customer ${id} checked in and seated`});
    } else {
        res.status(404).json({ message: 'Customer not ready or already seated'});
    }
});

seatQueue.process(async (job) => {
    const { customerId } = job.data;
    const customer = customers.find(c => c.id == customerId); // todo: need to check if id is string or number
    
    if (customer) {
        customer.status = 'done';
        // todo: add back available seats
        
        // notify next awaiting customer
        const nextCustomer = customers.find(c => c.status === 'waiting');
        // todo: check if there are enough available seats
        if (nextCustomer) {
            nextCustomer.status = 'tableReady';
            console.log(`Found next customer ${nextCustomer.id}. Emitting tableReady event`);
            io.to(nextCustomer.id).emit('tableReady', {
                customerId: nextCustomer.id
            });
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