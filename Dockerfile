FROM node:20-bookworm-slim

WORKDIR /workspace

COPY . .

RUN npm ci

CMD ["npm", "run", "dev:backend"]
