import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { pool } from '../config/database.js';
import { AppError, asyncHandler } from '../middleware/errorHandler.js';
import { authenticate } from '../middleware/auth.js';


const router = Router();

// Register (keeping original endpoint)
router.post('/register', asyncHandler(async (req, res) => {
  const { businessName, email, password, name } = req.body;

  if (!businessName || !email || !password || !name) {
    throw new AppError('All fields are required', 400);
  }

  // Check if business already exists
  const existing = await pool.query(
    'SELECT id FROM businesses WHERE email = $1',
    [email]
  );

  if (existing.rows.length > 0) {
    throw new AppError('Business already exists', 400);
  }

  // Hash password
  const hashedPassword = await bcrypt.hash(password, 10);

  // Start transaction
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Create business
    const businessResult = await client.query(
      'INSERT INTO businesses (business_name, email, status) VALUES ($1, $2, $3) RETURNING id',
      [businessName, email, 'active']
    );
    const businessId = businessResult.rows[0].id;

    // Create user
    const userResult = await client.query(
      'INSERT INTO users (business_id, name, email, password_hash, role) VALUES ($1, $2, $3, $4, $5) RETURNING id, name, email, role',
      [businessId, name, email, hashedPassword, 'owner']
    );

    await client.query('COMMIT');

    const user = userResult.rows[0];
    const token = jwt.sign(
      { userId: user.id, businessId, email: user.email },
      process.env.JWT_SECRET || 'default-secret',
      { expiresIn: '7d' }
    );

    res.status(201).json({
      message: 'Registration successful',
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        businessId,
        businessName: businessName
      }
    });
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}));

// Signup (alternative endpoint for frontend compatibility)
router.post('/signup', asyncHandler(async (req, res) => {
  // Map frontend field names to backend
  const { name, company_name, email, password, companyName } = req.body;
  
  // Support both company_name and companyName
  const businessName = company_name || companyName;

  if (!businessName || !email || !password || !name) {
    throw new AppError('All fields are required', 400);
  }

  // Check if business already exists
  const existing = await pool.query(
    'SELECT id FROM businesses WHERE email = $1',
    [email]
  );

  if (existing.rows.length > 0) {
    throw new AppError('Email already registered', 400);
  }

  // Hash password
  const hashedPassword = await bcrypt.hash(password, 10);

  // Start transaction
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Create business
    const businessResult = await client.query(
      'INSERT INTO businesses (business_name, email, status, created_at) VALUES ($1, $2, $3, NOW()) RETURNING id, business_name',
      [businessName, email, 'active']
    );
    const businessId = businessResult.rows[0].id;

    // Create user
    const userResult = await client.query(
      'INSERT INTO users (business_id, name, email, password_hash, role, created_at) VALUES ($1, $2, $3, $4, $5, NOW()) RETURNING id, name, email, role',
      [businessId, name, email, hashedPassword, 'owner']
    );

    await client.query('COMMIT');

    const user = userResult.rows[0];
    const token = jwt.sign(
      { userId: user.id, businessId, email: user.email },
      process.env.JWT_SECRET || 'default-secret',
      { expiresIn: '7d' }
    );

    res.status(201).json({
      message: 'Registration successful',
      token,
      id: user.id,
      name: user.name,
      email: user.email,
      companyName: businessName
    });
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}));

// Login
router.post('/login', asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    throw new AppError('Email and password are required', 400);
  }

  // Find user
  const result = await pool.query(
    `SELECT u.id, u.business_id, u.name, u.email, u.password_hash, u.role, b.business_name
     FROM users u
     JOIN businesses b ON u.business_id = b.id
     WHERE u.email = $1 AND b.status = 'active'`,
    [email]
  );

  if (result.rows.length === 0) {
    throw new AppError('Invalid credentials', 401);
  }

  const user = result.rows[0];

  // Verify password
  const isValid = await bcrypt.compare(password, user.password_hash);

  if (!isValid) {
    throw new AppError('Invalid credentials', 401);
  }

  // Generate token
  const token = jwt.sign(
    { userId: user.id, businessId: user.business_id, email: user.email },
    process.env.JWT_SECRET || 'default-secret',
    { expiresIn: '7d' }
  );

  res.json({
    message: 'Login successful',
    token,
    id: user.id,
    name: user.name,
    email: user.email,
    companyName: user.business_name
  });
}));

// Logout (for frontend compatibility - token-based auth doesn't need server-side logout)
router.post('/logout', asyncHandler(async (req, res) => {
  // With JWT, logout is handled client-side by removing the token
  // This endpoint exists for API compatibility
  res.json({ 
    message: 'Logout successful. Please remove the token from client storage.' 
  });
}));

// Get current user
router.get('/me', authenticate, asyncHandler(async (req, res) => {
  const result = await pool.query(
    `SELECT u.id, u.name, u.email, u.role, u.business_id, b.business_name
     FROM users u
     JOIN businesses b ON u.business_id = b.id
     WHERE u.id = $1`,
    [req.user!.userId]
  );

  if (result.rows.length === 0) {
    throw new AppError('User not found', 404);
  }

  const user = result.rows[0];
  res.json({
    id: user.id,
    name: user.name,
    email: user.email,
    companyName: user.business_name,
    role: user.role
  });
}));

export default router;
