#!/bin/sh
set -e

#wait for Postgres to be ready
./wait-for-it.sh postgresDB:5432 --timeout=30 --strict -- echo "Postgres is up"
#wait for Redis to be ready
./wait-for-it.sh redis-pubsub:6379 --timeout=30 --strict -- echo "Redis is up"
#run the Prisma migrations
npx prisma migrate deploy
# Generate Prisma client
npx prisma generate

# Start the API server
exec npm start