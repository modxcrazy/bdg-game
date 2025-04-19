require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const cors = require('cors');
const path = require('path');

const app = express();

// Middleware
app.use(express.json());
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

// Database Connection
mongoose.connect(process.env.MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true
})
.then(() => console.log('Connected to MongoDB'))
.catch(err => console.error('MongoDB connection error:', err));

// Models
const UserSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    balance: { type: Number, default: 0 },
    createdAt: { type: Date, default: Date.now }
});

const ServiceSchema = new mongoose.Schema({
    name: { type: String, required: true },
    category: { type: String, required: true },
    min: { type: Number, required: true },
    max: { type: Number, required: true },
    rate: { type: Number, required: true },
    speed: { type: String, required: true },
    description: { type: String }
});

const OrderSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    serviceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Service', required: true },
    amount: { type: Number, required: true },
    price: { type: Number, required: true },
    status: { type: String, enum: ['pending', 'processing', 'completed', 'failed'], default: 'pending' },
    createdAt: { type: Date, default: Date.now }
});

const TransactionSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    amount: { type: Number, required: true },
    type: { type: String, enum: ['deposit', 'purchase', 'refund'], required: true },
    status: { type: String, enum: ['pending', 'completed', 'failed'], default: 'pending' },
    paymentMethod: { type: String },
    stripePaymentId: { type: String },
    createdAt: { type: Date, default: Date.now }
});

const User = mongoose.model('User', UserSchema);
const Service = mongoose.model('Service', ServiceSchema);
const Order = mongoose.model('Order', OrderSchema);
const Transaction = mongoose.model('Transaction', TransactionSchema);

// Middleware
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
app.post('/api/register', async (req, res) => {
    try {
        const { username, email, password } = req.body;
        
        if (await User.findOne({ email })) {
            return res.status(400).send('User already exists');
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        const user = new User({ username, email, password: hashedPassword });
        await user.save();

        const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: '7d' });
        res.status(201).send({ token, user: { id: user._id, username, email, balance: user.balance } });
    } catch (err) {
        res.status(500).send('Error registering user');
    }
});

app.post('/api/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const user = await User.findOne({ email });
        if (!user) return res.status(400).send('Invalid credentials');

        const validPassword = await bcrypt.compare(password, user.password);
        if (!validPassword) return res.status(400).send('Invalid credentials');

        const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: '7d' });
        res.send({ token, user: { id: user._id, username: user.username, email: user.email, balance: user.balance } });
    } catch (err) {
        res.status(500).send('Error logging in');
    }
});

app.get('/api/me', authenticate, async (req, res) => {
    try {
        const user = await User.findById(req.user.id).select('-password');
        res.send(user);
    } catch (err) {
        res.status(500).send('Error fetching user');
    }
});

app.get('/api/services', async (req, res) => {
    try {
        const { category } = req.query;
        const query = category ? { category } : {};
        const services = await Service.find(query);
        res.send(services);
    } catch (err) {
        res.status(500).send('Error fetching services');
    }
});

app.post('/api/orders', authenticate, async (req, res) => {
    try {
        const { serviceId, amount } = req.body;
        const service = await Service.findById(serviceId);
        if (!service) return res.status(404).send('Service not found');
        
        if (amount < service.min || amount > service.max) {
            return res.status(400).send(`Amount must be between ${service.min} and ${service.max}`);
        }
        
        const price = (amount * service.rate / 1000).toFixed(2);
        const user = await User.findById(req.user.id);
        if (user.balance < price) {
            return res.status(400).send('Insufficient balance');
        }
        
        user.balance -= parseFloat(price);
        await user.save();
        
        const order = new Order({
            userId: req.user.id,
            serviceId,
            amount,
            price,
            status: 'pending'
        });
        await order.save();
        
        const transaction = new Transaction({
            userId: req.user.id,
            amount: price,
            type: 'purchase',
            status: 'completed',
            paymentMethod: 'balance'
        });
        await transaction.save();
        
        res.status(201).send(order);
    } catch (err) {
        res.status(500).send('Error creating order');
    }
});

app.get('/api/orders', authenticate, async (req, res) => {
    try {
        const orders = await Order.find({ userId: req.user.id })
            .populate('serviceId', 'name category')
            .sort({ createdAt: -1 });
        res.send(orders);
    } catch (err) {
        res.status(500).send('Error fetching orders');
    }
});

app.post('/api/create-payment-intent', authenticate, async (req, res) => {
    try {
        const { amount } = req.body;
        if (amount < 5) return res.status(400).send('Minimum deposit is $5');
        
        const paymentIntent = await stripe.paymentIntents.create({
            amount: amount * 100,
            currency: 'usd',
            metadata: { userId: req.user.id.toString() }
        });
        
        res.send({ clientSecret: paymentIntent.client_secret });
    } catch (err) {
        res.status(500).send('Error creating payment intent');
    }
});

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
        const user = await User.findById(paymentIntent.metadata.userId);
        if (!user) return;
        
        const amount = paymentIntent.amount / 100;
        user.balance += amount;
        await user.save();
        
        const transaction = new Transaction({
            userId: user._id,
            amount,
            type: 'deposit',
            status: 'completed',
            paymentMethod: 'stripe',
            stripePaymentId: paymentIntent.id
        });
        await transaction.save();
    }

    res.json({ received: true });
});

// Serve frontend
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
