# WhatsApp CRM Backend

A comprehensive WhatsApp CRM backend with intelligent follow-up automation, billing management, and email notifications.

## 🚀 Features

### Core Features
- ✅ WhatsApp Business API Integration
- ✅ Contact Management & Pipeline Tracking
- ✅ Message Templates & Campaigns
- ✅ Automation Rules Engine
- ✅ Analytics & Reporting

### New Features
- 🎯 **Intelligent Follow-Up Automation**
  - Automatic deal status detection (Won/Lost/Needs Follow-up)
  - Smart follow-up scheduling based on contact stage
  - Sentiment analysis of conversations
  - Hot lead identification
  
- 💳 **Billing & Subscription Management**
  - Stripe payment integration
  - Multiple pricing plans
  - Usage tracking and limits
  - Automated invoice generation (PDF)
  - Subscription lifecycle management
  
- 📧 **Email Notifications (Brevo/SendinBlue)**
  - Welcome emails
  - Password reset
  - Subscription alerts
  - Usage warnings
  - Campaign completion reports
  - Daily activity summaries

## 📋 Prerequisites

- Node.js 18+ 
- PostgreSQL 14+
- Redis (optional, for job queues)
- Stripe Account (for payments)
- Brevo/SendinBlue Account (for emails)
- Meta WhatsApp Business API Account

## 🛠️ Installation

### 1. Clone the repository
```bash
git clone <repository-url>
cd whatsapp-crm-backend
```

### 2. Install dependencies
```bash
npm install
```

### 3. Set up environment variables
```bash
cp .env.example .env
```

Edit `.env` and configure:
- Database credentials
- WhatsApp API credentials
- Brevo API key
- Stripe API keys
- JWT secret

### 4. Set up the database
```bash
# Run migrations
npm run migrate

# Seed initial data (optional)
npm run seed
```

### 5. Start the server
```bash
# Development mode with hot reload
npm run dev

# Production mode
npm run build
npm start
```

## 🔧 Environment Variables

### Required Variables
```env
# Database
DB_HOST=localhost
DB_PORT=5432
DB_NAME=whatsapp_crm
DB_USER=postgres
DB_PASSWORD=your_password

# JWT
JWT_SECRET=your-secret-key

# WhatsApp API
WHATSAPP_API_TOKEN=your_token
WHATSAPP_PHONE_NUMBER_ID=your_phone_id

# Brevo
BREVO_API_KEY=your_brevo_key
BREVO_SENDER_EMAIL=noreply@yourdomain.com

# Stripe
STRIPE_SECRET_KEY=sk_test_your_key
STRIPE_WEBHOOK_SECRET=whsec_your_secret
```

See `.env.example` for complete list.

## 📚 API Documentation

### Authentication
All protected endpoints require JWT token in Authorization header:
```
Authorization: Bearer <your_jwt_token>
```

### Billing API

#### Get All Plans
```http
GET /api/billing/plans
```

**Response:**
```json
{
  "plans": [
    {
      "id": 1,
      "name": "Basic",
      "conversation_limit": 1000,
      "price": "29.99"
    }
  ]
}
```

#### Create Subscription
```http
POST /api/billing/subscription
Authorization: Bearer <token>
Content-Type: application/json

{
  "planId": 1
}
```

#### Get Active Subscription
```http
GET /api/billing/subscription
Authorization: Bearer <token>
```

#### Get Usage Statistics
```http
GET /api/billing/usage?period=month
Authorization: Bearer <token>
```

**Response:**
```json
{
  "usage": {
    "total_conversations": 450,
    "total_cost": "45.00",
    "period_start": "2025-01-01",
    "period_end": "2025-01-31"
  }
}
```

#### Generate Invoice
```http
POST /api/billing/invoice/generate
Authorization: Bearer <token>
Content-Type: application/json

{
  "period": "January 2025",
  "items": [
    {
      "description": "WhatsApp Conversations",
      "quantity": 450,
      "price": 0.10
    }
  ],
  "total": 45.00
}
```

Returns PDF file download.

### Follow-Up Automation API

#### Get Follow-Up Statistics
```http
GET /api/followup/stats
Authorization: Bearer <token>
```

**Response:**
```json
{
  "stats": {
    "total_contacts": 1000,
    "deals_won": 150,
    "deals_lost": 50,
    "followups_sent": 300,
    "needs_followup": 75
  }
}
```

#### Get Hot Leads
```http
GET /api/followup/hot-leads
Authorization: Bearer <token>
```

**Response:**
```json
{
  "count": 10,
  "leads": [
    {
      "id": 123,
      "name": "John Doe",
      "phone": "+1234567890",
      "stage": "Negotiation",
      "message_count": 15,
      "inbound_count": 8,
      "last_interaction": "2025-02-08T10:30:00Z"
    }
  ]
}
```

#### Create Custom Follow-Up Rule
```http
POST /api/followup/custom-rule
Authorization: Bearer <token>
Content-Type: application/json

{
  "stage": "Qualified",
  "hoursAfterLastMessage": 48,
  "messageTemplate": "Hi {name}! Just checking in...",
  "maxFollowUps": 3
}
```

#### Analyze Conversation Sentiment
```http
GET /api/followup/sentiment/:contactId
Authorization: Bearer <token>
```

**Response:**
```json
{
  "contactId": 123,
  "sentiment": "positive"
}
```

#### Manually Process Follow-Ups
```http
POST /api/followup/process
Authorization: Bearer <token>
```

### Contact Management

#### Create Contact
```http
POST /api/contacts
Authorization: Bearer <token>
Content-Type: application/json

{
  "phone": "+1234567890",
  "name": "John Doe",
  "stage": "New"
}
```

#### Get All Contacts
```http
GET /api/contacts?page=1&limit=50&stage=Qualified
Authorization: Bearer <token>
```

#### Update Contact Stage
```http
PATCH /api/contacts/:id/stage
Authorization: Bearer <token>
Content-Type: application/json

{
  "stage": "Won"
}
```

### Campaign Management

#### Create Campaign
```http
POST /api/campaigns
Authorization: Bearer <token>
Content-Type: application/json

{
  "name": "Spring Sale",
  "templateId": 1,
  "scheduledAt": "2025-03-01T10:00:00Z",
  "contactIds": [1, 2, 3, 4, 5]
}
```

#### Get Campaign Statistics
```http
GET /api/campaigns/:id/stats
Authorization: Bearer <token>
```

### Automation Rules

#### Create Automation Rule
```http
POST /api/automation
Authorization: Bearer <token>
Content-Type: application/json

{
  "trigger": "contact_created",
  "condition": {},
  "action": {
    "type": "send_message",
    "message": "Welcome! How can we help you today?"
  },
  "delayMinutes": 0
}
```

Available triggers:
- `contact_created` - When a new contact is added
- `message_received` - When a message is received
- `stage_changed` - When contact stage changes
- `scheduled_followup` - Scheduled follow-up

Available actions:
- `send_message` - Send a text message
- `send_template` - Send a template message
- `update_stage` - Update contact stage
- `add_tag` - Add a tag to contact

## 🔄 Automated Processes

### Campaign Scheduler
Runs every 5 minutes (configurable) to process scheduled campaigns.

### Follow-Up Scheduler
Runs every hour to:
- Identify contacts needing follow-up
- Send automated follow-up messages
- Analyze message sentiment
- Detect deal status changes

### Usage Monitoring
Automatically tracks:
- Conversation counts
- API usage
- Subscription limits
- Sends alerts at 80% and 100% usage

## 🎯 Deal Detection

The system automatically analyzes incoming messages to detect:

### Deal Won Keywords
- "yes", "sure", "confirmed", "deal", "agreed"
- "accept", "buy", "purchase", "order"
- "booking", "reserve", "perfect"

### Deal Lost Keywords
- "no thanks", "not interested", "cancel"
- "too expensive", "can't afford"
- "not for me", "decline"

### Needs Follow-Up Keywords
- "thinking", "maybe", "not sure"
- "let me think", "i'll let you know"
- "discuss", "check"

## 📊 Database Schema

### Core Tables
- `businesses` - Business accounts
- `users` - User accounts
- `contacts` - Contact records
- `messages` - Message history
- `campaigns` - Marketing campaigns
- `automation_rules` - Automation rules

### Billing Tables
- `plans` - Subscription plans
- `subscriptions` - Active subscriptions
- `usage_logs` - Usage tracking

### Analytics Tables
- `pipeline_history` - Stage transition history
- `campaign_logs` - Campaign delivery logs
- `contact_tags` - Contact tagging

## 🔐 Security Features

- JWT-based authentication
- Password hashing with bcrypt
- Rate limiting on all endpoints
- CORS protection
- SQL injection prevention (parameterized queries)
- Input validation with Zod

## 📧 Email Templates

The system supports email notifications via Brevo. You can:

1. Use custom Brevo templates (set template IDs in .env)
2. Use default HTML templates

Email types:
- Welcome emails
- Password reset
- Subscription notifications
- Usage alerts
- Campaign reports
- Daily summaries

## 💰 Billing Flow

1. **Sign Up**: User creates account (trial)
2. **Choose Plan**: Select from available plans
3. **Payment**: Stripe handles payment
4. **Activation**: Subscription activated
5. **Usage Tracking**: Every conversation tracked
6. **Alerts**: Email notifications at 80% usage
7. **Renewal**: Automatic monthly renewal
8. **Invoice**: PDF invoice generation

## 🚨 Error Handling

All errors are logged and return standardized JSON:

```json
{
  "error": "Error message",
  "statusCode": 400,
  "timestamp": "2025-02-08T12:00:00Z"
}
```

## 📝 Logging

Logs are stored in:
- `logs/combined.log` - All logs
- `logs/error.log` - Error logs only

Log levels: error, warn, info, debug

## 🧪 Testing

```bash
# Run tests (when implemented)
npm test

# Run specific test
npm test -- contact.test.ts
```

## 🚀 Deployment

### Docker Deployment
```bash
docker build -t whatsapp-crm-backend .
docker run -p 5000:5000 --env-file .env whatsapp-crm-backend
```

### Traditional Deployment
1. Set up PostgreSQL database
2. Configure environment variables
3. Run migrations: `npm run migrate`
4. Build: `npm run build`
5. Start: `npm start`

## 📱 WhatsApp Webhook Setup

1. Go to Meta Developer Console
2. Configure webhook URL: `https://yourdomain.com/api/whatsapp/webhook`
3. Set verify token (from .env)
4. Subscribe to message events

## 🔄 Migration from Old Version

If upgrading from a previous version:

```bash
# Backup database
pg_dump whatsapp_crm > backup.sql

# Run new migrations
npm run migrate

# Restart server
npm start
```

## 🤝 Contributing

1. Fork the repository
2. Create feature branch
3. Commit changes
4. Push to branch
5. Create Pull Request

## 📄 License

MIT License - See LICENSE file for details

## 🆘 Support

For issues and questions:
- Open an issue on GitHub
- Email: support@yourdomain.com
- Documentation: https://docs.yourdomain.com

## 🎉 Acknowledgments

- Meta WhatsApp Business API
- Brevo (SendinBlue) for email service
- Stripe for payment processing
- Express.js framework
- PostgreSQL database

---

Built with ❤️ for modern WhatsApp CRM needs