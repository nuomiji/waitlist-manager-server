import Redis from 'ioredis';

import { Customer } from './types';

const CUSTOMERS_KEY = 'customers';
const CUSTOER_ID_KEY = 'customerIdCounter';
const AVAILABLE_SEATS_KEY = 'availableSeats'

let redis: Redis;

export const initRedis = () => {
    return new Promise<void>((resolve, reject) => {

        redis = new Redis();

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
    })
};

export const addCustomerToRedis = async (customer: Customer) => {
    await redis.hset(CUSTOMERS_KEY, customer.id, JSON.stringify(customer));
};


export const deleteCustomerFromRedis = async (customerId: string) => {
    return await redis.hdel(CUSTOMERS_KEY, customerId);
};

export const getCustomerFromRedis = async (customerId: string) => {
    const customerStr = await redis.hget(CUSTOMERS_KEY, customerId);

    if (!customerStr) {
        return null;
    }

    try {
        return JSON.parse(customerStr);
    } catch (err) {
        console.error(`Faild to parse customer ${customerId} from redis`);
        return null;
    }
};

export const getAllCustomersFromRedis = async (): Promise<Customer[]> => {
    try {
        const customers = await redis.hgetall(CUSTOMERS_KEY);
        return Object.values(customers).map(c => JSON.parse(c));
    } catch (err) {
        console.error(`Failed to get or parse customers from redis`);
        return [];
    }
};

export const getNextCustomerId = async () => {
    return await redis.incr(CUSTOER_ID_KEY);
};

export const getAvailableSeats = async () : Promise<number | null> => {
    const seats = await redis.get(AVAILABLE_SEATS_KEY);
    if (seats) {
        return parseInt(seats);
    } else {
        console.error(`Failed to get availableSeats`);
        return null;
    }
};

export const setAvailableSeats = async (seats: number) => {
    return await redis.set(AVAILABLE_SEATS_KEY, seats.toString());
};