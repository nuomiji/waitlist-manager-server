// tests/server.test.js

import { expect } from 'chai';
import axios from 'axios';
import RedisMock from 'redis-mock';
const { createClient: createMockClient } = RedisMock;

let server;

const PORT = 3001;
const BASE_URL = `http://localhost:${PORT}`;

const mockRedisClient = createMockClient();

before(async () => {
  const { initRedis } = await import('../dist/redis-helpers.js');
  await initRedis(mockRedisClient);

  try {
    const serverModule = await import('../dist/server.js');
    server = serverModule.server;
  } catch (err) {
    console.error('Failed to start the server for tests:', err);
    throw err;
  }
});

after(async () => {
  await mockRedisClient.quit(); // Close the Redis mock client

  // Close the server
  if (server) {
    await new Promise((resolve, reject) => {
      server.close((err) => {
        if (err) return reject(err);
        console.log('Test server closed');
        resolve();
      });
    });
  }
});

describe('API Endpoints', () => {
  it('should return 200 OK on GET /health', async () => {
    const res = await axios.get(`${BASE_URL}/health`);
    expect(res.status).to.equal(200);
  });

  it('should add a new customer on POST /api/customers', async () => {
    const newCustomer = { name: 'Kelly', partySize: 10 };
    const res = await axios.post(`${BASE_URL}/api/customers`, newCustomer);
    expect(res.status).to.equal(200);
    expect(res.data).to.have.property('id');
    expect(res.data.name).to.equal(newCustomer.name);
  });

  it('should return customer details on GET /api/customers', async () => {
    const newCustomer = { name: 'Kelly', partySize: 8 };
    let res = await axios.post(`${BASE_URL}/api/customers`, newCustomer);
    expect(res.status).to.equal(200);
    const createdCustomer = res.data;
    
    res = await axios.get(`${BASE_URL}/api/customers/${createdCustomer.id}`);
    expect(res.data.id).to.equal(createdCustomer.id);
    expect(res.data.name).to.equal(createdCustomer.name);
    expect(res.data.partySize).to.equal(createdCustomer.partySize);
    expect(res.data.status).to.exist;
  });

  it('should delete a customer on DELETE /api/customers/:id', async () => {
    const customerId = 1;
    let res = await axios.delete(`${BASE_URL}/api/customers/${customerId}`);
    expect(res.status).to.equal(204);

    try {
      res = await axios.get(`${BASE_URL}/api/customers/${customerId.id}`);
      throw new Error('Shouldn\'t get to here');
    } catch (err) {
      expect(err.status).to.equal(404);
    }
  });
});
