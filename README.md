# Restaurant Waitlist Management Server

## Overview

This server is part of a restaurant waitlist management system built using **Express.js**, **Socket.IO**, **Bull**, and **Redis**. The primary purpose is to handle customer management for a restaurant's seating system, including placing customers in a queue, seating them, and notifying them when tables are ready.

The system supports real-time updates using WebSockets and manages asynchronous job processing (like seating and customer notifications) via the Bull queue.

### Key Features
- **Real-time updates** with WebSocket for notifying customers when tables are ready.
- **Queue management** using Redis to store and retrieve customer data.
- **Asynchronous job processing** using Bull for handling seating and table readiness.
- **Redis pub/sub adapter** for scaling the WebSocket connections across multiple instances.

## Installation

1. **Clone the repository**:
   ```bash
   git clone <repository-url>
   cd <repository-folder>
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Start Redis** (if not already running):
   ```bash
   redis-server
   ```

4. **Run the server**:
   ```bash
   npm start
   ```

## Environment Variables

- `PORT`: The port on which the server will run. Defaults to `3001`.
- `REDIS_URL`: The Redis instance URL. Defaults to `redis://localhost:6379`.

## Redis Integration

This system uses Redis to store customer data and manage available seating information. It also uses the Redis adapter for **Socket.IO** to handle WebSocket connections across multiple server instances.

## Bull Queue

The Bull queue handles background tasks, specifically managing customer seating and notifying the next customer when tables are available.

---

## API Endpoints

### `GET /api/customers/:id`

**Fetches customer details**, including their position in the queue, party size, and status.

- **Parameters**: 
  - `id`: Customer ID
- **Response**: 
  - `200`: Returns customer details (id, name, partySize, status, and position).
  - `404`: Customer not found.
  - `500`: Error fetching available seats.

### `POST /api/customers`

**Adds a new customer to the queue.**

- **Request Body**:
  ```json
  {
    "name": "Customer Name",
    "partySize": 4
  }
  ```
- **Response**:
  - `200`: Returns new customer details (id, name, partySize, status, position).
  - `400`: Request rejected if the party size exceeds the total number of available seats.
  - `500`: Error fetching available seats or adding customer to the queue.

### `DELETE /api/customers/:id`

**Removes a customer from the queue.**

- **Parameters**: 
  - `id`: Customer ID
- **Response**:
  - `204`: Customer successfully deleted.
  - `500`: Error deleting the customer from Redis.

### `PUT /api/customers/:id/check-in`

**Checks in a customer when a table is ready.**

- **Parameters**: 
  - `id`: Customer ID
- **Response**:
  - `200`: Customer successfully seated.
  - `404`: Customer not ready or already seated.
  - `500`: Error fetching available seats or seating the customer.

---

## Socket.IO Events

### `connection`

Handles client connection events and listens for customer-specific actions.

### `setCustomerId`

This event is triggered by the client to associate a customer with their socket connection. It enables the server to notify the specific customer when their table is ready.

### `tableReady`

Emitted by the server when a table is ready for a customer. This is done through the customer's socket connection.

---

## Bull Queue Processing

### `seatQueue.process`

Handles when a customer finishes dining. This task is delayed for the duration of the customer's dining session (determined by party size and a fixed time per person). Once completed, the customer is removed from the system, and the next customer in line is notified if there is space.

---

## Constants

- **SERVE_TIME_PER_PERSON**: Time (in milliseconds) that each person in a party occupies a seat. Currently set to `3000 ms` (3 seconds per person).
- **TOTAL_SEATS**: The total number of seats available in the restaurant. Currently set to `10`.

---

## Running the Application

Once the server is started, customers can be added to the queue via the REST API, and WebSocket connections can be used to notify them when their tables are ready.

