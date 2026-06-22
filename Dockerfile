FROM node:18-alpine
WORKDIR /usr/src/app

# Copy and install dependencies
COPY package*.json .
RUN npm install

# Copy source code
COPY . .

EXPOSE 3131

# Set PORT for Node.js
ENV PORT=3131

CMD ["node", "src/runtime/server.js"]