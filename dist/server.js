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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
const express_1 = __importDefault(require("express"));
const http_1 = __importDefault(require("http"));
const socket_io_1 = require("socket.io");
const cors_1 = __importDefault(require("cors"));
const bull_1 = __importDefault(require("bull"));
const redis_adapter_1 = require("@socket.io/redis-adapter");
const redis_1 = require("redis");
const redis_helpers_1 = require("./redis-helpers");
const CLIENT_HOST = process.env.CLIENT_HOST;
const app = (0, express_1.default)();
const server = http_1.default.createServer(app);
const io = new socket_io_1.Server(server, {
    cors: {
        origin: CLIENT_HOST,
        methods: ['GET', 'POST'],
        credentials: false
    }
});
// Set up Redis clients for the Socket.io adapter
const pubClient = (0, redis_1.createClient)({ url: process.env.REDIS_URL });
const subClient = pubClient.duplicate();
pubClient.connect();
subClient.connect();
// Attach the Redis adapter to Socket.io for multi-instance communication
io.adapter((0, redis_adapter_1.createAdapter)(pubClient, subClient));
const SERVE_TIME_PER_PERSON = 3 * 1000;
const TOTAL_SEATS = 10;
const seatQueue = (0, bull_1.default)('seating', {
    redis: process.env.REDIS_URL
});
/**
 * Initializes Redis and updates available seats based on the current customer data.
 */
(0, redis_helpers_1.initRedis)()
    .then(redis_helpers_1.getAllCustomersFromRedis)
    .then((customers) => {
    // Recalculate number of seated people upon app start up
    return customers.reduce((seated, c) => {
        if (c.status === 'seated') {
            return seated + c.partySize;
        }
        else {
            return seated;
        }
    }, 0);
})
    .then((seated) => {
    console.log(`setting availableSeats to ${TOTAL_SEATS - seated}`);
    (0, redis_helpers_1.setAvailableSeats)(TOTAL_SEATS - seated); // note this is async
})
    .catch((err) => {
    console.error(err);
});
app.use((0, cors_1.default)());
app.use(express_1.default.json());
/**
 * Maps socket to a customerId so we know which socket to inform when the table is ready.
 * @param {Socket} socket The connected socket instance
 */
io.on('connection', (socket) => {
    /**
     * Associates a customer ID with the socket connection
     * @param {Object} data - Contains the customerId.
     * @param {number} data.customerId - The customer ID to associate with the socket.
     */
    socket.on('setCustomerId', (data) => {
        socket.join(data.customerId.toString());
    });
});
/**
 * Fetches customer details, including their queue position and seating status.
 * @route GET /api/customers/:id
 * @param {Request} req - Express request object
 * @param {Response} res - Express response object
 */
app.get('/api/customers/:id', (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const { id } = req.params;
    const customer = yield (0, redis_helpers_1.getCustomerFromRedis)(id);
    const cachedCustomers = yield (0, redis_helpers_1.getAllCustomersFromRedis)();
    const availableSeats = yield (0, redis_helpers_1.getAvailableSeats)();
    if (customer && availableSeats !== null) {
        const position = cachedCustomers.filter((c) => inQueue(c) && c.id < customer.id).length;
        if (position === 0 && customer.status === 'waiting' && customer.partySize <= availableSeats) {
            customer.status = 'tableReady';
            yield (0, redis_helpers_1.addCustomerToRedis)(customer);
        }
        res.json({
            id: customer.id,
            name: customer.name,
            partySize: customer.partySize,
            status: customer.status,
            position
        });
    }
    else if (availableSeats !== null) {
        console.log('No customer found');
        res.status(404).json({ message: 'Customer not found' });
    }
    else {
        console.error(`Error in fetching availableSeats in the server`);
        res.status(500).json({ message: `Error in fetching availableSeats in the server` });
    }
}));
/**
 * Deletes a customer from the system.
 * @route DELETE /api/customers/:id
 * @param {Request} req - Express request object
 * @param {Response} res - Express response object
 */
app.delete('/api/customers/:id', (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const { id } = req.params;
    try {
        yield (0, redis_helpers_1.deleteCustomerFromRedis)(id);
        res.sendStatus(204);
    }
    catch (err) {
        console.error(`Failed to delete customer from redis`);
        res.sendStatus(500);
    }
}));
/**
 * Adds a new customer to the queue.
 * @route POST /api/customers
 * @param {Request} req - Express request object containing customer name and party size
 * @param {Response} res - Express response object
 */
app.post('/api/customers', (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const availableSeats = yield (0, redis_helpers_1.getAvailableSeats)();
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
    const newCustomer = {
        id: yield (0, redis_helpers_1.getNextCustomerId)(),
        name,
        partySize,
        status: 'waiting'
    };
    const customers = yield (0, redis_helpers_1.getAllCustomersFromRedis)();
    const position = customers.filter(inQueue).length;
    if (position === 0 && newCustomer.partySize <= availableSeats) {
        newCustomer.status = 'tableReady';
    }
    yield (0, redis_helpers_1.addCustomerToRedis)(newCustomer);
    res.json({
        id: newCustomer.id,
        name: newCustomer.name,
        partySize: newCustomer.partySize,
        status: newCustomer.status,
        position
    });
}));
/**
 * Checks in a customer, seating them if their table is ready.
 * @route PUT /api/customers/:id/check-in
 * @param {Request} req - Express request object containing the customer ID
 * @param {Response} res - Express response object
 */
app.put('/api/customers/:id/check-in', (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    const id = (_a = req.params) === null || _a === void 0 ? void 0 : _a.id;
    const customer = yield (0, redis_helpers_1.getCustomerFromRedis)(id);
    let availableSeats = yield (0, redis_helpers_1.getAvailableSeats)();
    if (availableSeats === null) {
        console.error(`Error in fetching availableSeats in the server`);
        res.status(500).json({ message: `Error in fetching availableSeats in the server` });
        return;
    }
    if ((customer === null || customer === void 0 ? void 0 : customer.status) === 'tableReady' && customer.partySize <= availableSeats) {
        customer.status = 'seated';
        availableSeats -= customer.partySize;
        yield (0, redis_helpers_1.setAvailableSeats)(availableSeats);
        yield (0, redis_helpers_1.addCustomerToRedis)(customer);
        console.log(`Seating customer ${id}. There are ${availableSeats} seats available`);
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
 * Health check endpoint. Checks if app is running properly.
 * @route GET /health
 * @param {Request} req - Express request object containing the customer ID
 * @param {Response} res - Express response object
 */
app.get('/health', (_req, res) => __awaiter(void 0, void 0, void 0, function* () {
    res.sendStatus(200);
}));
/**
 * Processes the completion of a customer's dining session and notifies the next waiting customer.
 * @param {Object} job - Bull job containing the customerId
 */
seatQueue.process((job) => __awaiter(void 0, void 0, void 0, function* () {
    const { customerId } = job.data;
    const customer = yield (0, redis_helpers_1.getCustomerFromRedis)(customerId);
    let availableSeats = yield (0, redis_helpers_1.getAvailableSeats)();
    if (availableSeats === null) {
        console.error(`Error in fetching availableSeats in the server`);
        throw Error(`Error in fetching availableSeats in the server`);
    }
    if (customer) {
        yield (0, redis_helpers_1.deleteCustomerFromRedis)(customerId);
        availableSeats += customer.partySize;
        yield (0, redis_helpers_1.setAvailableSeats)(availableSeats);
        console.log(`Customer ${customer.id} finished dining and are leaving the restaurant. Available seats now: ${availableSeats}`);
        try {
            const customers = yield (0, redis_helpers_1.getAllCustomersFromRedis)();
            const nextCustomer = customers.find((c) => c.status === 'waiting');
            availableSeats = yield (0, redis_helpers_1.getAvailableSeats)();
            if (availableSeats === null) {
                console.error(`Error in fetching availableSeats in the server`);
                throw Error(`Error in fetching availableSeats in the server`);
            }
            if (nextCustomer && nextCustomer.partySize <= availableSeats) {
                nextCustomer.status = 'tableReady';
                yield (0, redis_helpers_1.addCustomerToRedis)(nextCustomer);
                io.to(nextCustomer.id.toString()).emit('tableReady');
                console.log(`Notified customer ${nextCustomer.id} that their table is ready`);
            }
        }
        catch (err) {
            console.error(`Failed to get the next customer to sit`);
        }
    }
}));
/**
 * Determines if a customer is still in the queue (either waiting or tableReady).
 * @param {Customer} c - The customer object.
 * @returns {boolean} - True if the customer is in the queue, otherwise false.
 */
function inQueue(c) {
    return c.status === 'waiting' || c.status === 'tableReady';
}
const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
