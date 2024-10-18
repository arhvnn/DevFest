// server.js

const express = require('express');
const path = require('path')
const Throttle = require('throttle');
const fs = require('fs')
const { Pool } = require('pg');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Create a new pool instance
const pool = new Pool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: process.env.DB_PORT,
});

// Middleware to parse JSON requests
app.use(express.json());

// Test database connection
app.get('/test-db', async (req, res) => {
    try {
        const result = await pool.query('SELECT NOW()'); // Just getting the current time from the DB
        res.json(result.rows[0]);
    } catch (err) {
        console.error('Database connection error', err);
        res.status(500).json({ error: 'Database connection error' });
    }
});

app.post('/clients', async (req, res) => {
    const { name, max_bandwidth, committed_ip_rate } = req.body;
    try {
        const result = await pool.query(
            'INSERT INTO clients (client_name, max_bandwidth, cir) VALUES ($1, $2, $3) RETURNING *',
            [name, max_bandwidth, committed_ip_rate]
        );
        res.status(201).json(result.rows[0]);
    } catch (err) {
        console.error('Error creating client', err);
        res.status(500).json({ error: 'Error creating client' });
    }
});

// API route to log bandwidth usage
app.post('/bandwidth-usage', async (req, res) => {
    const { client_id, requested_bandwidth, allocated_bandwidth } = req.body;
    try {
        const result = await pool.query(
            'INSERT INTO bandwidth_stats (client_id, requested_bandwidth, allocated_bandwidth) VALUES ($1, $2, $3) RETURNING *',
            [client_id, requested_bandwidth, allocated_bandwidth]
        );
        res.status(201).json(result.rows[0]);
    } catch (err) {
        console.error('Error logging bandwidth usage', err);
        res.status(500).json({ error: 'Error logging bandwidth usage' });
    }
});

// API route to get bandwidth usage for a client
app.get('/bandwidth-usage/:client_id', async (req, res) => {
    const { client_id } = req.params;
    try {
        const result = await pool.query(
            'SELECT * FROM bandwidth_usage WHERE client_id = $1 ORDER BY timestamp DESC',
            [client_id]
        );
        res.json(result.rows);
    } catch (err) {
        console.error('Error retrieving bandwidth usage', err);
        res.status(500).json({ error: 'Error retrieving bandwidth usage' });
    }
});

// Object to store bandwidth usage for each client
const clientBandwidthUsage = {};

// Set a bandwidth limit to 1.5 MB per second
const BANDWIDTH_LIMIT = 100000 * 1024 * 1024; // 1.5 MB in bytes

app.get('/download', (req, res) => {
    const clientId = req.query.client_id || 'unknown'; // Get client ID from query parameter
    console.log(`Download requested by client: ${clientId}`);
    const filePath = path.join(__dirname, 'file.zip'); // Update path if needed

    if (!fs.existsSync(filePath)) {
        return res.status(404).send('File not found');
    }

    const stat = fs.statSync(filePath);
    res.writeHead(200, {
        'Content-Type': 'application/zip', // Change to appropriate type
        'Content-Length': stat.size,
    });

    const readStream = fs.createReadStream(filePath);
    const throttle = new Throttle(BANDWIDTH_LIMIT); // Create a throttle stream

    // Create a variable to track the total bytes sent
    let totalBytesSent = 0;
    const startTime = Date.now();

    // Initialize bandwidth usage for the client
    clientBandwidthUsage[clientId] = { totalBytesSent: 0, startTime };

    // Pipe the read stream through the throttle to the response
    readStream.pipe(throttle).pipe(res);

    throttle.on('data', (chunk) => {
        totalBytesSent += chunk.length; // Update the total bytes sent
        clientBandwidthUsage[clientId].totalBytesSent += chunk.length; // Update client's total bytes sent

        const elapsedTime = (Date.now() - clientBandwidthUsage[clientId].startTime) / 1000; // Time in seconds
        const kbps = (clientBandwidthUsage[clientId].totalBytesSent * 8) / 1024 / elapsedTime; // Convert to kbps

        // Log the kbps for the specific client
        console.log(`${clientId} bw: ${kbps.toFixed(2)} kbps`);
    });

    readStream.on('end', () => {
        console.log(`Download complete for client: ${clientId}`);
    });

    readStream.on('error', (err) => {
        console.error('Stream error:', err);
        res.status(500).send('Internal Server Error');
    });
});

// Start the server
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});

