FROM node:18-alpine

RUN apk add --no-cache git python3 make g++

WORKDIR /app

COPY package*.json ./

RUN npm install

COPY . .

RUN npx hardhat compile

CMD ["npx", "hardhat", "test"]
