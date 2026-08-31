FROM node:22-alpine

WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --ignore-scripts
COPY src ./src

ENV HOST=0.0.0.0
ENV PORT=4444
EXPOSE 4444

CMD ["npm", "start"]
