FROM node:22-alpine AS build

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . ./
RUN npm run build

FROM node:22-alpine AS runtime

WORKDIR /app

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=8000
ENV IRRIGATION_APP_DATA_DIR=/data

COPY package*.json ./
RUN npm ci --omit=dev && mkdir -p /data

COPY --from=build /app/build ./build

EXPOSE 8000

CMD ["node", "build"]