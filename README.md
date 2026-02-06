# WhatsApp CRM Backend

A RESTful API backend for the WhatsApp CRM application built with Express, TypeScript, and PostgreSQL.

## Features

- 🔐 JWT-based authentication
- 📊 Contact management
- 💬 Message handling
- 📧 Campaign management
- 🤖 Automation rules
- 📈 Analytics and reporting
- 🎯 Sales pipeline management
- 📝 Message templates

## Tech Stack

- **Runtime**: Node.js
- **Framework**: Express.js
- **Language**: TypeScript
- **Database**: PostgreSQL
- **Authentication**: JWT (jsonwebtoken)
- **Validation**: Zod
- **Logging**: Winston

## Prerequisites

- Node.js 18+ 
- PostgreSQL 14+
- npm or yarn

## Getting Started

### 1. Install Dependencies

```bash
npm install
```

### 2. Environment Configuration

Copy `.env.example` to `.env` and configure your environment variables:

```bash
cp .env.example .env
```

Update the following variables in `.env`:

```env
# Server Configuration
PORT=5000
NODE_ENV=development

# Database Configuration
DATABASE_URL=postgresql://user:password@host:port/database

# JWT Secret (CHANGE THIS IN PRODUCTION!)
JWT_SECRET=your-super-secret-jwt-key-change-this-in-production

# CORS Origin (frontend URL)
CORS_ORIGIN=http://localhost:3000

# API Rate Limiting
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX_REQUESTS=100
```

### 3. Run Database Migrations

```bash
npm run migrate
```

### 4. (Optional) Seed Database

```bash
npm run seed
```

### 5. Start Development Server

```bash
npm run dev
```

The server will start on `http://localhost:5000`

## Available Scripts

- `npm run dev` - Start development server with hot reload
- `npm run build` - Build for production
- `npm start` - Start production server
- `npm run migrate` - Run database migrations
- `npm run seed` - Seed database with sample data

## API Endpoints

### Authentication
- `POST /api/auth/register` - Register new user
- `POST /api/auth/login` - Login user
- `POST /api/auth/logout` - Logout user
- `GET /api/auth/me` - Get current user

### Contacts
- `GET /api/contacts` - List all contacts
- `POST /api/contacts` - Create new contact
- `GET /api/contacts/:id` - Get contact by ID
- `PUT /api/contacts/:id` - Update contact
- `DELETE /api/contacts/:id` - Delete contact

### Messages
- `GET /api/messages` - List messages
- `POST /api/messages` - Send message
- `GET /api/messages/:id` - Get message by ID

### Campaigns
- `GET /api/campaigns` - List campaigns
- `POST /api/campaigns` - Create campaign
- `GET /api/campaigns/:id` - Get campaign by ID
- `PUT /api/campaigns/:id` - Update campaign
- `DELETE /api/campaigns/:id` - Delete campaign

### Templates
- `GET /api/templates` - List templates
- `POST /api/templates` - Create template
- `GET /api/templates/:id` - Get template by ID
- `PUT /api/templates/:id` - Update template
- `DELETE /api/templates/:id` - Delete template

### Automation
- `GET /api/automation` - List automation rules
- `POST /api/automation` - Create automation rule
- `GET /api/automation/:id` - Get rule by ID
- `PUT /api/automation/:id` - Update rule
- `DELETE /api/automation/:id` - Delete rule

### Analytics
- `GET /api/analytics/summary` - Get analytics summary
- `GET /api/analytics/messages` - Get message analytics
- `GET /api/analytics/campaigns` - Get campaign analytics

### Pipeline
- `GET /api/pipeline` - Get pipeline stages
- `POST /api/pipeline/move` - Move contact between stages

## Project Structure

```
whatsapp-crm-backend/
├── src/
│   ├── config/
│   │   └── database.ts       # Database configuration
│   ├── middleware/
│   │   ├── auth.ts           # JWT authentication middleware
│   │   └── errorHandler.ts  # Global error handler
│   ├── routes/
│   │   ├── auth.routes.ts
│   │   ├── contact.routes.ts
│   │   ├── message.routes.ts
│   │   ├── campaign.routes.ts
│   │   ├── template.routes.ts
│   │   ├── automation.routes.ts
│   │   ├── analytics.routes.ts
│   │   └── pipeline.routes.ts
│   ├── utils/
│   │   └── logger.ts         # Winston logger configuration
│   └── index.ts              # Application entry point
├── logs/                     # Application logs
├── .env                      # Environment variables
├── .env.example              # Environment template
├── package.json
├── tsconfig.json
└── README.md
```

## Deployment

### Build for Production

```bash
npm run build
```

This creates a `dist/` folder with compiled JavaScript.

### Start Production Server

```bash
npm start
```

### Environment Variables for Production

Make sure to set these environment variables in your production environment:

- `NODE_ENV=production`
- `DATABASE_URL` - Your production database URL
- `JWT_SECRET` - A strong, random secret key
- `CORS_ORIGIN` - Your frontend production URL
- `PORT` - Server port (default: 5000)

### Deployment Platforms

This backend can be deployed to:

- **Heroku**: Use the included `Procfile`
- **DigitalOcean App Platform**: Works out of the box
- **AWS EC2/Elastic Beanstalk**: Configure Node.js environment
- **Render**: Add build command: `npm install && npm run build`
- **Railway**: Auto-detects and deploys
- **Fly.io**: Use Node.js buildpack

## Security Considerations

1. **JWT Secret**: Use a strong, random secret in production
2. **CORS**: Configure `CORS_ORIGIN` to match your frontend domain
3. **Rate Limiting**: Already configured, adjust limits as needed
4. **Database**: Use SSL connection in production
5. **Environment Variables**: Never commit `.env` files
6. **HTTPS**: Use HTTPS in production (configure via reverse proxy)

## Logging

Logs are stored in the `logs/` directory:
- `combined.log` - All logs
- `error.log` - Error logs only

Winston logger is configured to output to both console and files.

## Health Check

The API includes a health check endpoint:

```bash
GET /health
```

Returns:
```json
{
  "status": "ok",
  "database": "connected"
}
```

## License

MIT

## Support

For issues and questions, please open an issue in the repository.
