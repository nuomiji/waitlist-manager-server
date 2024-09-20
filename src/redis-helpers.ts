import Redis from 'ioredis';
import { Customer } from './types';

const CUSTOMERS_KEY = 'customers';
const CUSTOER_ID_KEY = 'customerIdCounter';
const AVAILABLE_SEATS_KEY = 'availableSeats';

let redis: Redis;

/**
 * Initializes the Redis client and sets up connection event handlers.
 * 
 * @returns {Promise<void>} A promise that resolves when Redis is ready, or rejects on connection failure
 */
export const initRedis = (redisClient = null): Promise<void> => {
    if (redisClient) {
        return redisClient;
    }

    return new Promise<void>((resolve, reject) => {
        redis = new Redis(process.env.REDIS_URL!);

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

/**
 * Adds a customer to Redis.
 * 
 * @param {Customer} customer - The customer object to be added
 * @returns {Promise<void>} A promise that resolves when the customer is added
 */
export const addCustomerToRedis = async (customer: Customer): Promise<void> => {
    await redis.hset(CUSTOMERS_KEY, customer.id, JSON.stringify(customer));
};

/**
 * Deletes a customer from Redis.
 * 
 * @param {string} customerId - The ID of the customer to delete
 * @returns {Promise<number>} A promise that resolves to the number of fields that were removed
 */
export const deleteCustomerFromRedis = async (customerId: string): Promise<number> => {
    return await redis.hdel(CUSTOMERS_KEY, customerId);
};

/**
 * Retrieves a customer from Redis by their ID.
 * 
 * @param {string} customerId - The ID of the customer to retrieve
 * @returns {Promise<Customer | null>} A promise that resolves to the customer object, or null if not found
 */
export const getCustomerFromRedis = async (customerId: string): Promise<Customer | null> => {
    const customerStr = await redis.hget(CUSTOMERS_KEY, customerId);

    if (!customerStr) {
        return null;
    }

    try {
        return JSON.parse(customerStr);
    } catch (err) {
        console.error(`Failed to parse customer ${customerId} from redis`);
        return null;
    }
};

/**
 * Retrieves all customers from Redis.
 * 
 * @returns {Promise<Customer[]>} A promise that resolves to an array of customer objects
 */
export const getAllCustomersFromRedis = async (): Promise<Customer[]> => {
    try {
        const customers = await redis.hgetall(CUSTOMERS_KEY);
        return Object.values(customers).map(c => JSON.parse(c));
    } catch (err) {
        console.error(`Failed to get or parse customers from redis`);
        return [];
    }
};

/**
 * Increments and retrieves the next available customer ID.
 * 
 * @returns {Promise<number>} A promise that resolves to the next available customer ID
 */
export const getNextCustomerId = async (): Promise<number> => {
    return await redis.incr(CUSTOER_ID_KEY);
};

/**
 * Retrieves the number of available seats from Redis.
 * 
 * @returns {Promise<number | null>} A promise that resolves to the number of available seats, or null if retrieval fails
 */
export const getAvailableSeats = async (): Promise<number | null> => {
    const seats = await redis.get(AVAILABLE_SEATS_KEY);
    if (seats) {
        return parseInt(seats);
    } else {
        console.error(`Failed to get availableSeats`);
        return null;
    }
};

/**
 * Sets the number of available seats in Redis.
 * 
 * @param {number} seats - The number of available seats to set
 * @returns {Promise<'OK' | null>} A promise that resolves when the seats value is set
 */
export const setAvailableSeats = async (seats: number): Promise<'OK' | null> => {
    return await redis.set(AVAILABLE_SEATS_KEY, seats.toString());
};
