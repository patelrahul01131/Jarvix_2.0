# 1. Use the correct slim image (fixed the typo)
FROM node:20-slim

# 2. Install build tools for better-sqlite3
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# 3. Set the working directory
WORKDIR /usr/src/app

# 4. Copy package files and install dependencies
# Doing this before copying source code allows Docker to cache the layers
COPY package*.json ./
RUN npm install

# 5. Copy the rest of your application source code
COPY . .

# 6. Set Environment Variables
ENV PORT=3131

# 7. Expose the port
EXPOSE 3131

# 8. Start the application
# (Removed the duplicate CMD; using the specific path provided)
CMD ["node", "src/runtime/server.js"]