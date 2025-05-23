FROM node:22

RUN apt-get update && apt-get install -y tzdata && rm -rf /var/lib/apt/lists/*
ENV TZ=Europe/Warsaw

WORKDIR /app

COPY package*.json ./

RUN npm install

COPY . .

CMD ["node", "--es-module-specifier-resolution=node", "index.js"]