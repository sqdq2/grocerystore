FROM node:22-alpine
WORKDIR /app
COPY . .
RUN mkdir -p data
ENV PORT=3000 BGS_DB=/app/data/store.db
EXPOSE 3000
CMD ["node", "server/index.js"]
