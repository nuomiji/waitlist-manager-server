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
const ioredis_1 = __importDefault(require("ioredis"));
const CUSTOMERS_KEY = 'customers';
const CUSTOER_ID_KEY = 'customerIdCounter';
const AVAILABLE_SEATS_KEY = 'availableSeats';
let redis;
module.exports = {
    initRedis: () => {
        return new Promise((resolve, reject) => {
            redis = new ioredis_1.default();
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
    },
    addCustomerToRedis: (customer) => __awaiter(void 0, void 0, void 0, function* () {
        yield redis.hset(CUSTOMERS_KEY, customer.id, JSON.stringify(customer));
    }),
    deleteCustomerFromRedis: (customerId) => __awaiter(void 0, void 0, void 0, function* () {
        return yield redis.hdel(CUSTOMERS_KEY, customerId);
    }),
    getCustomerFromRedis: (customerId) => __awaiter(void 0, void 0, void 0, function* () {
        const customerStr = yield redis.hget(CUSTOMERS_KEY, customerId);
        if (!customerStr) {
            return null;
        }
        try {
            return JSON.parse(customerStr);
        }
        catch (err) {
            console.error(`Faild to parse customer ${customerId} from redis`);
            return null;
        }
    }),
    getAllCustomersFromRedis: () => __awaiter(void 0, void 0, void 0, function* () {
        try {
            const customers = yield redis.hgetall(CUSTOMERS_KEY);
            return Object.values(customers).map(c => JSON.parse(c));
        }
        catch (err) {
            console.error(`Failed to get or parse customers from redis`);
        }
    }),
    getNextCustomerId: () => __awaiter(void 0, void 0, void 0, function* () {
        return yield redis.incr(CUSTOER_ID_KEY);
    }),
    getAvailableSeats: () => __awaiter(void 0, void 0, void 0, function* () {
        const seats = yield redis.get(AVAILABLE_SEATS_KEY);
        if (seats) {
            return parseInt(seats);
        }
        else {
            console.error(`Failed to get availableSeats`);
        }
    }),
    setAvailableSeats: (seats) => __awaiter(void 0, void 0, void 0, function* () {
        return yield redis.set(AVAILABLE_SEATS_KEY, seats.toString());
    }),
};
