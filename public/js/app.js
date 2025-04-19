// Global variables
let currentUser = null;
let authToken = localStorage.getItem('authToken');
let stripe = null;
let elements = null;
let cardElement = null;

// Initialize the app
document.addEventListener('DOMContentLoaded', async () => {
    // Initialize Stripe
    stripe = Stripe(process.env.STRIPE_PUBLIC_KEY);
    elements = stripe.elements();
    cardElement = elements.create('card');
    cardElement.mount('#card-element');
    
    // Setup event listeners
    setupEventListeners();
    
    // Check if user is logged in
    if (authToken) {
        try {
            const user = await fetchUser();
            if (user) {
                currentUser = user;
                updateUIForLoggedInUser();
                loadServices();
                loadOrders();
                loadStats();
            } else {
                showLoginForm();
            }
        } catch (err) {
            console.error('Error checking auth:', err);
            showLoginForm();
        }
    } else {
        showLoginForm();
    }
});

// Setup event listeners
function setupEventListeners() {
    // Auth forms
    if (loginForm) loginForm.addEventListener('submit', handleLogin);
    if (registerForm) registerForm.addEventListener('submit', handleRegister);
    if (showRegister) showRegister.addEventListener('click', (e) => {
        e.preventDefault();
        document.getElementById('login-form').style.display = 'none';
        document.getElementById('register-form').style.display = 'block';
    });
    if (showLogin) showLogin.addEventListener('click', (e) => {
        e.preventDefault();
        document.getElementById('register-form').style.display = 'none';
        document.getElementById('login-form').style.display = 'block';
    });
    
    // Deposit
    if (depositBtn) depositBtn.addEventListener('click', () => depositModal.style.display = 'flex');
    
    // Close modals
    closeModalButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.modal').forEach(modal => modal.style.display = 'none');
        });
    });
    
    // Order form
    if (orderForm) orderForm.addEventListener('submit', handleOrder);
    
    // Deposit form
    if (depositForm) depositForm.addEventListener('submit', handleDeposit);
}

// Fetch current user
async function fetchUser() {
    try {
        const response = await fetch('/api/me', {
            headers: {
                'Authorization': `Bearer ${authToken}`
            }
        });
        
        if (response.ok) {
            return await response.json();
        } else {
            localStorage.removeItem('authToken');
            return null;
        }
    } catch (err) {
        console.error('Error fetching user:', err);
        return null;
    }
}

// Update UI for logged in user
function updateUIForLoggedInUser() {
    // Hide auth forms, show dashboard
    document.querySelectorAll('.auth-form').forEach(el => el.style.display = 'none');
    document.querySelectorAll('.user-content').forEach(el => el.style.display = 'block');
    
    // Update user info
    if (userBalanceElement) {
        userBalanceElement.textContent = currentUser.balance.toFixed(2);
    }
    
    // Update username in header
    const usernameDisplay = document.getElementById('username-display');
    if (usernameDisplay) {
        usernameDisplay.textContent = currentUser.username;
    }
}

// Show login form
function showLoginForm() {
    document.querySelectorAll('.auth-form').forEach(el => el.style.display = 'none');
    document.getElementById('login-form').style.display = 'block';
    document.querySelectorAll('.user-content').forEach(el => el.style.display = 'none');
}

// Handle login
async function handleLogin(e) {
    e.preventDefault();
    const email = document.getElementById('login-email').value;
    const password = document.getElementById('login-password').value;
    
    try {
        const response = await fetch('/api/login', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ email, password })
        });
        
        if (response.ok) {
            const data = await response.json();
            authToken = data.token;
            localStorage.setItem('authToken', authToken);
            currentUser = data.user;
            updateUIForLoggedInUser();
            loadServices();
            loadOrders();
            loadStats();
        } else {
            const error = await response.text();
            alert(error);
        }
    } catch (err) {
        console.error('Login error:', err);
        alert('Login failed. Please try again.');
    }
}

// Handle register
async function handleRegister(e) {
    e.preventDefault();
    const username = document.getElementById('register-username').value;
    const email = document.getElementById('register-email').value;
    const password = document.getElementById('register-password').value;
    
    try {
        const response = await fetch('/api/register', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ username, email, password })
        });
        
        if (response.ok) {
            const data = await response.json();
            authToken = data.token;
            localStorage.setItem('authToken', authToken);
            currentUser = data.user;
            updateUIForLoggedInUser();
            loadServices();
            loadOrders();
            loadStats();
        } else {
            const error = await response.text();
            alert(error);
        }
    } catch (err) {
        console.error('Registration error:', err);
        alert('Registration failed. Please try again.');
    }
}

// Handle logout
function handleLogout() {
    localStorage.removeItem('authToken');
    authToken = null;
    currentUser = null;
    showLoginForm();
}

// Load services
async function loadServices() {
    try {
        const response = await fetch('/api/services');
        if (response.ok) {
            const services = await response.json();
            renderServices(services);
        }
    } catch (err) {
        console.error('Error loading services:', err);
    }
}

// Render services
function renderServices(services) {
    if (!serviceList) return;
    
    serviceList.innerHTML = services.map(service => `
        <div class="service-card">
            <h3>${service.name}</h3>
            <div class="service-meta">
                <span>Min: ${service.min}</span>
                <span>Max: ${service.max}</span>
                <span>Speed: ${service.speed}</span>
            </div>
            <div class="service-price">$${(service.rate / 1000).toFixed(2)} / 1k</div>
            <div class="service-actions">
                <button class="btn btn-outline">Details</button>
                <button class="btn btn-primary" 
                    data-service-id="${service.id}"
                    data-service-name="${service.name}"
                    data-service-min="${service.min}"
                    data-service-max="${service.max}"
                    data-service-rate="${service.rate}">
                    Order Now
                </button>
            </div>
        </div>
    `).join('');
    
    // Add event listeners to order buttons
    document.querySelectorAll('.service-card .btn-primary').forEach(button => {
        button.addEventListener('click', function() {
            const serviceId = this.getAttribute('data-service-id');
            const serviceName = this.getAttribute('data-service-name');
            const min = this.getAttribute('data-service-min');
            const max = this.getAttribute('data-service-max');
            const rate = this.getAttribute('data-service-rate');
            
            showOrderModal(serviceId, serviceName, min, max, rate);
        });
    });
}

// Show order modal
function showOrderModal(serviceId, serviceName, min, max, rate) {
    document.getElementById('order-service').value = serviceName;
    document.getElementById('order-amount').min = min;
    document.getElementById('order-amount').max = max;
    document.getElementById('order-amount').value = min;
    document.getElementById('amount-range').textContent = `(Min: ${min}, Max: ${max})`;
    
    // Calculate initial price
    const price = (min * rate / 1000).toFixed(2);
    document.getElementById('order-price').textContent = price;
    
    // Update price when amount changes
    document.getElementById('order-amount').addEventListener('input', function() {
        const amount = parseInt(this.value) || min;
        const price = (amount * rate / 1000).toFixed(2);
        document.getElementById('order-price').textContent = price;
    });
    
    // Store service ID in form
    orderForm.setAttribute('data-service-id', serviceId);
    orderForm.setAttribute('data-service-rate', rate);
    
    orderModal.style.display = 'flex';
}

// Handle order submission
async function handleOrder(e) {
    e.preventDefault();
    const serviceId = orderForm.getAttribute('data-service-id');
    const amount = parseInt(document.getElementById('order-amount').value);
    const link = document.getElementById('order-link').value;
    
    try {
        const response = await fetch('/api/orders', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            },
            body: JSON.stringify({ serviceId, amount })
        });
        
        if (response.ok) {
            const order = await response.json();
            alert(`Order #${order.id.substring(0, 6)} placed successfully!`);
            orderModal.style.display = 'none';
            loadOrders();
            loadStats();
            
            // Update balance
            currentUser.balance -= order.price;
            if (userBalanceElement) {
                userBalanceElement.textContent = currentUser.balance.toFixed(2);
            }
        } else {
            const error = await response.text();
            alert(error);
        }
    } catch (err) {
        console.error('Order error:', err);
        alert('Failed to place order. Please try again.');
    }
}

// Load orders
async function loadOrders() {
    try {
        const response = await fetch('/api/orders', {
            headers: {
                'Authorization': `Bearer ${authToken}`
            }
        });
        
        if (response.ok) {
            const orders = await response.json();
            renderOrders(orders);
        }
    } catch (err) {
        console.error('Error loading orders:', err);
    }
}

// Render orders
function renderOrders(orders) {
    if (!ordersTable) return;
    
    ordersTable.innerHTML = orders.map(order => `
        <tr>
            <td>#ORD-${order.id.substring(0, 6)}</td>
            <td>${order.service?.name || 'N/A'}</td>
            <td>${order.amount}</td>
            <td>$${order.price.toFixed(2)}</td>
            <td><span class="status ${order.status}">${order.status}</span></td>
            <td>${new Date(order.createdAt).toLocaleDateString()}</td>
        </tr>
    `).join('');
}

// Load stats
async function loadStats() {
    try {
        // In a real app, you would fetch these from the backend
        document.getElementById('total-balance').textContent = currentUser.balance.toFixed(2);
        document.getElementById('orders-today').textContent = '3';
        document.getElementById('completed-orders').textContent = '24';
        document.getElementById('pending-orders').textContent = '2';
    } catch (err) {
        console.error('Error loading stats:', err);
    }
}

// Handle deposit
async function handleDeposit(e) {
    e.preventDefault();
    const amount = parseFloat(document.getElementById('deposit-amount').value);
    
    if (isNaN(amount)) {
        alert('Please enter a valid amount');
        return;
    }
    
    if (amount < 5) {
        alert('Minimum deposit is $5');
        return;
    }
    
    try {
        // Create payment intent
        const response = await fetch('/api/create-payment-intent', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            },
            body: JSON.stringify({ amount })
        });
        
        if (response.ok) {
            const { clientSecret } = await response.json();
            
            // Confirm payment
            const { error, paymentIntent } = await stripe.confirmCardPayment(clientSecret, {
                payment_method: {
                    card: cardElement,
                    billing_details: {
                        name: currentUser.username
                    }
                }
            });
            
            if (error) {
                alert(error.message);
            } else if (paymentIntent.status === 'succeeded') {
                alert('Deposit successful!');
                depositModal.style.display = 'none';
                
                // Update balance
                currentUser.balance += amount;
                if (userBalanceElement) {
                    userBalanceElement.textContent = currentUser.balance.toFixed(2);
                }
            }
        } else {
            const error = await response.text();
            alert(error);
        }
    } catch (err) {
        console.error('Deposit error:', err);
        alert('Deposit failed. Please try again.');
    }
}
