FROM node:20-alpine AS client-build
WORKDIR /app/client
COPY client/package*.json ./
RUN npm install
COPY client ./
RUN npm run build

FROM node:20-alpine
WORKDIR /app
COPY server/package*.json ./server/
RUN cd server && npm install --omit=dev
COPY server ./server
COPY --from=client-build /app/client/dist ./server/public
ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000
CMD ["node","server/index.js"]
