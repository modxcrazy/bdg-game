require('dotenv').config();
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const cors = require('cors');
const path = require('path');
const admin = require('firebase-admin');
const serviceAccount = require('./serviceAccountKey.json');

// Initialize Firebase
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: process.env.FIREBASE_DATABASE_URL
});

const db = admin.database();
const usersRef = db.ref('users');
const servicesRef = db.ref('services');
const ordersRef = db.ref('orders');
const transactionsRef = db.ref('transactions');

const app = express();

// Middleware
app.use(express.json());
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

// Authentication Middleware
const authenticate = (req, res, next) => {
    const token = req.header('Authorization')?.replace('Bearer ', '');
    if (!token) return res.status(401).send('Access denied');

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.user = decoded;
        next();
    } catch (err) {
        res.status(400).send('Invalid token');
    }
};

// Routes

// User Registration
app.post('/api/register', async (req, res) => {
    try {
        const { username, email, password } = req.body;
        
        // Check if user exists
        const snapshot = await usersRef.orderByChild('email').equalTo(email).once('value');
        if (snapshot.exists()) {
            return res.status(400).send('User already exists');
        }

        // Hash password
        const hashedPassword = await bcrypt.hash(password, 10);
        const newUserRef = usersRef.push();
        
        await newUserRef.set({
            username,
            email,
            password: hashedPassword,
            balance: 0,
            createdAt: admin.database.ServerValue.TIMESTAMP
        });

        // Generate JWT
        const token = jwt.sign({ id: newUserRef.key }, process.env.JWT_SECRET, { expiresIn: '7d' });

        res.status(201).send({ 
            token, 
            user: { 
                id: newUserRef.key, 
                username, 
                email, 
                balance: 0 
            } 
        });
    } catch (err) {
        res.status(500).send('Error registering user');
    }
});

// User Login
app.post('/api/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        
        // Find user
        const snapshot = await usersRef.orderByChild('email').equalTo(email).once('value');
        if (!snapshot.exists()) {
            return res.status(400).send('Invalid credentials');
        }
        
        const users = snapshot.val();
        const userId = Object.keys(users)[0];
        const user = users[userId];

        // Check password
        const validPassword = await bcrypt.compare(password, user.password);
        if (!validPassword) return res.status(400).send('Invalid credentials');

        // Generate JWT
        const token = jwt.sign({ id: userId }, process.env.JWT_SECRET, { expiresIn: '7d' });

        res.send({ 
            token, 
            user: { 
                id: userId, 
                username: user.username, 
                email: user.email, 
                balance: user.balance 
            } 
        });
    } catch (err) {
        res.status(500).send('Error logging in');
    }
});

// Get current user
app.get('/api/me', authenticate, async (req, res) => {
    try {
        const snapshot = await usersRef.child(req.user.id).once('value');
        const user = snapshot.val();
        if (!user) return res.status(404).send('User not found');
        
        // Remove password before sending
        const { password, ...userData } = user;
        res.send({ id: req.user.id, ...userData });
    } catch (err) {
        res.status(500).send('Error fetching user');
    }
});

// Get all services
app.get('/api/services', async (req, res) => {
    try {
        const { category } = req.query;
        const snapshot = await servicesRef.once('value');
        let services = snapshot.val() || {};
        
        services = Object.keys(services).map(key => ({
            id: key,
            ...services[key]
        }));
        
        if (category) {
            services = services.filter(service => service.category === category);
        }
        
        res.send(services);
    } catch (err) {
        res.status(500).send('Error fetching services');
    }
});

// Create order
app.post('/api/orders', authenticate, async (req, res) => {
    try {
        const { serviceId, amount } = req.body;
        
        // Get service
        const serviceSnapshot = await servicesRef.child(serviceId).once('value');
        const service = serviceSnapshot.val();
        
        if (!service) return res.status(404).send('Service not found');
        
        // Validate amount
        if (amount < service.min || amount > service.max) {
            return res.status(400).send(`Amount must be between ${service.min} and ${service.max}`);
        }
        
        // Calculate price
        const price = (amount * service.rate / 1000).toFixed(2);
        
        // Check user balance
        const userSnapshot = await usersRef.child(req.user.id).once('value');
        const user = userSnapshot.val();
        
        if (user.balance < price) {
            return res.status(400).send('Insufficient balance');
        }
        
        // Deduct balance
        const newBalance = user.balance - parseFloat(price);
        await usersRef.child(req.user.id).update({ balance: newBalance });
        
        // Create order
        const newOrderRef = ordersRef.push();
        await newOrderRef.set({
            userId: req.user.id,
            serviceId,
            amount,
            price,
            status: 'pending',
            createdAt: admin.database.ServerValue.TIMESTAMP
        });
        
        // Create transaction
        const newTransactionRef = transactionsRef.push();
        await newTransactionRef.set({
            userId: req.user.id,
            amount: price,
            type: 'purchase',
            status: 'completed',
            paymentMethod: 'balance',
            createdAt: admin.database.ServerValue.TIMESTAMP
        });
        
        res.status(201).send({ 
            id: newOrderRef.key,
            userId: req.user.id,
            serviceId,
            amount,
            price,
            status: 'pending',
            createdAt: Date.now()
        });
    } catch (err) {
        res.status(500).send('Error creating order');
    }
});

// Get user orders
app.get('/api/orders', authenticate, async (req, res) => {
    try {
        const snapshot = await ordersRef.orderByChild('userId').equalTo(req.user.id).once('value');
        let orders = snapshot.val() || {};
        
        orders = Object.keys(orders).map(key => ({
            id: key,
            ...orders[key]
        }));
        
        // Get service details for each order
        const ordersWithServices = await Promise.all(orders.map(async order => {
            const serviceSnapshot = await servicesRef.child(order.serviceId).once('value');
            const service = serviceSnapshot.val();
            return {
                ...order,
                service: {
                    name: service?.name,
                    category: service?.category
                }
            };
        }));
        
        res.send(ordersWithServices);
    } catch (err) {
        res.status(500).send('Error fetching orders');
    }
});

// Create payment intent (Stripe)
app.post('/api/create-payment-intent', authenticate, async (req, res) => {
    try {
        const { amount } = req.body;
        
        if (amount < 5) return res.status(400).send('Minimum deposit is $5');
        
        const paymentIntent = await stripe.paymentIntents.create({
            amount: amount * 100,
            currency: 'usd',
            metadata: { userId: req.user.id.toString() }
        });
        
        res.send({
            clientSecret: paymentIntent.client_secret
        });
    } catch (err) {
        res.status(500).send('Error creating payment intent');
    }
});

// Webhook for Stripe payments
app.post('/api/webhook', express.raw({type: 'application/json'}), async (req, res) => {
    const sig = req.headers['stripe-signature'];
    let event;

    try {
        event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
    } catch (err) {
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    if (event.type === 'payment_intent.succeeded') {
        const paymentIntent = event.data.object;
        const userId = paymentIntent.metadata.userId;
        
        // Find user
        const userSnapshot = await usersRef.child(userId).once('value');
        const user = userSnapshot.val();
        if (!user) return;
        
        // Add to balance
        const amount = paymentIntent.amount / 100;
        const newBalance = user.balance + amount;
        await usersRef.child(userId).update({ balance: newBalance });
        
        // Create transaction
        const newTransactionRef = transactionsRef.push();
        await newTransactionRef.set({
            userId,
            amount,
            type: 'deposit',
            status: 'completed',
            paymentMethod: 'stripe',
            stripePaymentId: paymentIntent.id,
            createdAt: admin.database.ServerValue.TIMESTAMP
        });
    }

    res.json({ received: true });
});

// Serve frontend
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
