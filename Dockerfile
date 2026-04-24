FROM node:18
WORKDIR /app
COPY package*.json ./
RUN npm config set registry https://registry.yarnpkg.com/
RUN npm install
COPY . .
EXPOSE 3000
CMD ["npm", "start"]