const Redis = require('ioredis');

const CUSTOMERS_KEY = 'customers';
const CUSTOER_ID_KEY = 'customerIdCounter';
let redis;

module.exports = {
    initRedis: () => {
        redis = new Redis();

        redis.on('connect', () => {
            console.log(`Redis client connected`);
        });

        redis.on('ready', () => {
            console.log(`Redis client ready to use`);
        });

        redis.on('error', (err) => {
            console.error('Redis connection error:', err);
        });

        redis.on('close', () => {
            console.log('Redis connection closed');
        });

        redis.on('reconnecting', () => {
            console.log('Redis client reconnecting...');
        });

        redis.on('end', () => {
            console.log('Redis connection ended');
        });
    },
    addCustomerToRedis: async (customer) => {
        await redis.hset(CUSTOMERS_KEY, customer.id, JSON.stringify(customer));
    },
    deleteCustomerFromRedis: async (customerId) => {
        return await redis.hdel(CUSTOMERS_KEY, customerId);
    },
    getCustomerFromRedis: async (customerId) => {
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
    },
    getAllCustomersFromRedis: async () => {
        try {
            const customers = await redis.hgetall(CUSTOMERS_KEY);
            return Object.values(customers).map(c => JSON.parse(c));
        } catch (err) {
            console.error(`Failed to get or parse customers from redis`);
        }
    },
    getNextCustomerId: async () => {
        return await redis.incr(CUSTOER_ID_KEY);
    }
}



