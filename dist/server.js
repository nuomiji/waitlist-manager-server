"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const Queue = require('bull');
const { initRedis, addCustomerToRedis, deleteCustomerFromRedis, getCustomerFromRedis, getAllCustomersFromRedis, getNextCustomerId, getAvailableSeats, setAvailableSeats, } = require('./redis-helpers');
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
    .catch((err) => {
    console.error(err);
});
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
app.get('/api/customers/:id', (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const { id } = req.params;
    const customer = yield getCustomerFromRedis(id);
    const cachedCustomers = yield getAllCustomersFromRedis();
    if (customer) {
        const position = cachedCustomers.filter((c) => inQueue(c) && c.id < customer.id).length;
        if (position === 0 && customer.status === 'waiting' && customer.partySize <= (yield getAvailableSeats())) {
            customer.status = 'tableReady';
            yield addCustomerToRedis(customer);
        }
        res.json({
            id: customer.id,
            name: customer.name,
            partySize: customer.partySize,
            status: customer.status,
            position
        });
    }
    else {
        console.log('No customer found');
        res.status(404).json({ message: 'Customer not found' });
    }
}));
app.delete('/api/customers/:id', (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const { id } = req.params;
    try {
        yield deleteCustomerFromRedis(id);
        res.sendStatus(204);
    }
    catch (err) {
        console.error(`Failed to delete customer from redis`);
        res.sendStatus(500);
    }
}));
/**
 * Handles when a new customer joins
 */
app.post('/api/customers', (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const { name, partySize } = req.body;
    if (partySize > TOTAL_SEATS) {
        res.status(400).json({
            message: `Sorry. We cannot take groups larger than ${TOTAL_SEATS} people`
        });
        return;
    }
    const newCustomer = {
        id: yield getNextCustomerId(),
        name,
        partySize,
        status: 'waiting'
    };
    // this will do a parse on all the customers, maybe there is a more efficient way
    const customers = yield getAllCustomersFromRedis();
    const position = customers.filter(inQueue).length;
    // currently there are 2 places where we set tableReady. Maybe this is not good
    if (position === 0 && newCustomer.partySize <= (yield getAvailableSeats())) {
        newCustomer.status = 'tableReady';
    }
    yield addCustomerToRedis(newCustomer);
    res.json({
        id: newCustomer.id,
        name: newCustomer.name,
        partySize: newCustomer.partySize,
        status: newCustomer.status,
        position
    });
}));
app.put('/api/customers/:id/check-in', (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    const id = Number((_a = req.params) === null || _a === void 0 ? void 0 : _a.id);
    const customer = yield getCustomerFromRedis(id);
    let availableSeats = yield getAvailableSeats();
    if ((customer === null || customer === void 0 ? void 0 : customer.status) === 'tableReady' && customer.partySize <= availableSeats) {
        customer.status = 'seated';
        availableSeats -= customer.partySize;
        yield setAvailableSeats(availableSeats);
        yield addCustomerToRedis(customer);
        console.log(`Seating customer ${id}. Available seats now: ${availableSeats}`);
        seatQueue.add({ customerId: id }, {
            delay: customer.partySize * SERVE_TIME_PER_PERSON,
            removeOnComplete: true
        });
        res.json({ message: `Customer ${id} checked in and seated` });
    }
    else {
        res.status(404).json({ message: 'Customer not ready or already seated' });
    }
}));
/**
 * Handles when customer finishes eating. We seat the next customer
 */
seatQueue.process((job) => __awaiter(void 0, void 0, void 0, function* () {
    const { customerId } = job.data;
    const customer = yield getCustomerFromRedis(customerId);
    if (customer) {
        yield deleteCustomerFromRedis(customerId);
        let availableSeats = yield getAvailableSeats();
        availableSeats += customer.partySize;
        yield setAvailableSeats(availableSeats);
        console.log(`Customer ${customer.id} finished dining and are leaving the restaurant. Available seats now: ${availableSeats}`);
        // notify next awaiting customer
        try {
            const customers = yield getAllCustomersFromRedis();
            const nextCustomer = customers.find((c) => c.status === 'waiting');
            // fetch availableSeats again to make sure we have the most up-to-date data
            availableSeats = yield getAvailableSeats();
            if (nextCustomer && nextCustomer.partySize <= availableSeats) {
                nextCustomer.status = 'tableReady';
                yield addCustomerToRedis(nextCustomer);
                const socket = socketMap[nextCustomer.id.toString()].find(c => c.connected);
                if (socket) {
                    console.log(`Found next customer ${nextCustomer.id} and corresponding socket. Emitting tableReady event`);
                    socket.emit('tableReady');
                }
                else {
                    console.log(`Found next customer ${nextCustomer.id} but cannot find corresponding socket`);
                }
                delete socketMap[nextCustomer.id.toString()];
            }
        }
        catch (err) {
            console.error(`Failed to get the next customer to sit`);
        }
    }
}));
function inQueue(c) {
    return c.status === 'waiting' || c.status === 'tableReady';
}
const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
