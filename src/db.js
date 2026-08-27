const { PrismaClient } = require('@prisma/client');

// A single shared Prisma client for the whole process — avoids exhausting DB connections
// by creating a new client per request.
const prisma = new PrismaClient();

module.exports = prisma;
