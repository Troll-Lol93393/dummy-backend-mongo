# Dummy Backend Mongo

Express TypeScript backend with MongoDB integration.

## Features

- **Express.js** with TypeScript
- **MongoDB** integration with Mongoose
- **CORS** enabled
- **Environment variables** support with dotenv
- Health check endpoint
- Sample API endpoints

## Prerequisites

- **Node.js** (v14 or higher)
- **MongoDB** (local or cloud instance)
- **npm** or **yarn**

## Installation

1. Clone the repository:

```bash
git clone <repository-url>
cd dummy-backend-mongo
```

2. Install dependencies:

```bash
npm install
```

3. Create environment file:

```bash
# Create .env file in the root directory with:
PORT=3000
NODE_ENV=development
MONGODB_URI=mongodb://localhost:27017/dummy-backend-mongo
CORS_ORIGIN=http://localhost:3000
```

## Available Scripts

- `npm start` - Start production server
- `npm run dev` - Start development server with hot reload
- `npm run build` - Build TypeScript to JavaScript
- `npm run build:watch` - Watch and build TypeScript files

## API Endpoints

- `GET /` - Root endpoint with API information
- `GET /health` - Health check endpoint
- `GET /api/users` - Get all users (sample endpoint)
- `POST /api/users` - Create new user (sample endpoint)

## Project Structure

```
dummy-backend-mongo/
├── src/
│   └── app.ts          # Main application file
├── public/             # Static files
├── dist/              # Compiled JavaScript (after build)
├── .env               # Environment variables
├── package.json       # Dependencies and scripts
├── tsconfig.json      # TypeScript configuration
├── nodemon.json       # Nodemon configuration
└── README.md          # This file
```

## Usage

1. Start MongoDB server (if running locally)
2. Run the development server:

```bash
npm run dev
```

3. Open http://localhost:3000 in your browser
4. Visit http://localhost:3000/health for health check

## Technologies Used

- **Express.js** - Web framework
- **TypeScript** - Type-safe JavaScript
- **Mongoose** - MongoDB object modeling
- **CORS** - Cross-origin resource sharing
- **dotenv** - Environment variables
- **Nodemon** - Development server with hot reload
