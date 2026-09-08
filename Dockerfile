FROM node:20-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY server.js index.html admin.html ./
COPY data ./data
COPY photos ./photos
ENV PORT=3000
EXPOSE 3000
VOLUME ["/app/data", "/app/photos"]
CMD ["node", "server.js"]
