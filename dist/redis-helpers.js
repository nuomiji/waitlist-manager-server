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
exports.setAvailableSeats = exports.getAvailableSeats = exports.getNextCustomerId = exports.getAllCustomersFromRedis = exports.getCustomerFromRedis = exports.deleteCustomerFromRedis = exports.addCustomerToRedis = exports.initRedis = void 0;
const ioredis_1 = __importDefault(require("ioredis"));
const CUSTOMERS_KEY = 'customers';
const CUSTOER_ID_KEY = 'customerIdCounter';
const AVAILABLE_SEATS_KEY = 'availableSeats';
let redis;
/**
 * Initializes the Redis client and sets up connection event handlers.
 *
 * @returns {Promise<void>} A promise that resolves when Redis is ready, or rejects on connection failure
 */
const initRedis = () => {
    return new Promise((resolve, reject) => {
        redis = new ioredis_1.default(process.env.REDIS_URL);
        redis.on('connect', () => {
            console.log(`Redis client connected`);
        });
        redis.on('ready', () => {
            console.log(`Redis client ready to use`);
            resolve();
        });
        redis.on('error', (err) => {
            console.error('Redis connection error:', err);
        });
        redis.on('close', () => {
            console.log('Redis connection closed');
            reject();
        });
        redis.on('reconnecting', () => {
            console.log('Redis client reconnecting...');
        });
        redis.on('end', () => {
            console.log('Redis connection ended');
        });
    });
};
exports.initRedis = initRedis;
/**
 * Adds a customer to Redis.
 *
 * @param {Customer} customer - The customer object to be added
 * @returns {Promise<void>} A promise that resolves when the customer is added
 */
const addCustomerToRedis = (customer) => __awaiter(void 0, void 0, void 0, function* () {
    yield redis.hset(CUSTOMERS_KEY, customer.id, JSON.stringify(customer));
});
exports.addCustomerToRedis = addCustomerToRedis;
/**
 * Deletes a customer from Redis.
 *
 * @param {string} customerId - The ID of the customer to delete
 * @returns {Promise<number>} A promise that resolves to the number of fields that were removed
 */
const deleteCustomerFromRedis = (customerId) => __awaiter(void 0, void 0, void 0, function* () {
    return yield redis.hdel(CUSTOMERS_KEY, customerId);
});
exports.deleteCustomerFromRedis = deleteCustomerFromRedis;
/**
 * Retrieves a customer from Redis by their ID.
 *
 * @param {string} customerId - The ID of the customer to retrieve
 * @returns {Promise<Customer | null>} A promise that resolves to the customer object, or null if not found
 */
const getCustomerFromRedis = (customerId) => __awaiter(void 0, void 0, void 0, function* () {
    const customerStr = yield redis.hget(CUSTOMERS_KEY, customerId);
    if (!customerStr) {
        return null;
    }
    try {
        return JSON.parse(customerStr);
    }
    catch (err) {
        console.error(`Failed to parse customer ${customerId} from redis`);
        return null;
    }
});
exports.getCustomerFromRedis = getCustomerFromRedis;
/**
 * Retrieves all customers from Redis.
 *
 * @returns {Promise<Customer[]>} A promise that resolves to an array of customer objects
 */
const getAllCustomersFromRedis = () => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const customers = yield redis.hgetall(CUSTOMERS_KEY);
        return Object.values(customers).map(c => JSON.parse(c));
    }
    catch (err) {
        console.error(`Failed to get or parse customers from redis`);
        return [];
    }
});
exports.getAllCustomersFromRedis = getAllCustomersFromRedis;
/**
 * Increments and retrieves the next available customer ID.
 *
 * @returns {Promise<number>} A promise that resolves to the next available customer ID
 */
const getNextCustomerId = () => __awaiter(void 0, void 0, void 0, function* () {
    return yield redis.incr(CUSTOER_ID_KEY);
});
exports.getNextCustomerId = getNextCustomerId;
/**
 * Retrieves the number of available seats from Redis.
 *
 * @returns {Promise<number | null>} A promise that resolves to the number of available seats, or null if retrieval fails
 */
const getAvailableSeats = () => __awaiter(void 0, void 0, void 0, function* () {
    const seats = yield redis.get(AVAILABLE_SEATS_KEY);
    if (seats) {
        return parseInt(seats);
    }
    else {
        console.error(`Failed to get availableSeats`);
        return null;
    }
});
exports.getAvailableSeats = getAvailableSeats;
/**
 * Sets the number of available seats in Redis.
 *
 * @param {number} seats - The number of available seats to set
 * @returns {Promise<'OK' | null>} A promise that resolves when the seats value is set
 */
const setAvailableSeats = (seats) => __awaiter(void 0, void 0, void 0, function* () {
    return yield redis.set(AVAILABLE_SEATS_KEY, seats.toString());
});
exports.setAvailableSeats = setAvailableSeats;
