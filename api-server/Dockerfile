FROM node:20.11.1

WORKDIR /app

COPY package*.json ./

RUN npm install

COPY . .

RUN chmod +x main.sh wait-for-it.sh

EXPOSE 8000

ENTRYPOINT [ "sh", "./main.sh" ] 