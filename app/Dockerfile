# docsys — Rania Municipality document system
#
# Two stages, because argon2 is a native addon that needs a compiler to build but
# not to run. The runtime image carries no compiler, which is one less thing on a
# machine that will hold municipal records.

FROM node:20-bookworm AS build
WORKDIR /srv
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# The reading model for Kurdish.
#
# Tesseract ships no Central Kurdish language pack; there is no ckb.traineddata
# and there never has been. Its Arabic LANGUAGE model reads Kurdish badly,
# because Kurdish Sorani uses letters Arabic does not have: it turns ژمارە into
# زماره and پارچە into يارجه, and no amount of normalising recovers that.
#
# Its Arabic SCRIPT model does read them, because it was trained on the shapes
# rather than on the Arabic language. On a typed Kurdish letter it produces
# "ژماره: ٢٤٧/٥" where the language model produced "زماره: 0/لاعلط". That is the
# difference between a searchable archive and a useless one, so it is worth the
# nine megabytes and the pinned download.
#
# Pinned to the 4.1.0 tag rather than main, so that rebuilding this image in
# two years produces the same reader and not whatever was committed since.
ARG TESSDATA=https://github.com/tesseract-ocr/tessdata_fast/raw/4.1.0/script/Arabic.traineddata
RUN curl -fsSL -o /tmp/Arabic.traineddata "$TESSDATA"

FROM node:20-bookworm-slim
ENV NODE_ENV=production
WORKDIR /srv

# tini reaps zombies and passes SIGTERM through, so the server's own shutdown
# handler runs and open transactions close cleanly.
#
# tesseract and poppler are what let the system find a letter by words printed
# inside a scan rather than only by what somebody typed into a field. They are
# installed here rather than called out to a service on purpose: reading a
# municipal letter happens on the municipality's own machine, and no scan leaves
# the building to be read by anybody.
#
#   tesseract-ocr-ara   Arabic script, which is what Kurdish Sorani is written in
#   tesseract-ocr-eng   the Latin runs: numbers, references, names
#   poppler-utils       pdftoppm, to turn a scanned PDF into pages to read
#
# About 120 MB of image. Without them the system still works and every scan is
# honestly labelled as not read, the same way it treats virus scanning.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      tini tesseract-ocr tesseract-ocr-ara tesseract-ocr-eng poppler-utils \
 && rm -rf /var/lib/apt/lists/*

COPY --from=build /tmp/Arabic.traineddata /usr/share/tesseract-ocr/5/tessdata/Arabic.traineddata
COPY --from=build /srv/node_modules ./node_modules
COPY --chown=node:node . .

# Uploads live here. Declared as a volume in compose so they survive a rebuild.
RUN mkdir -p /srv/files && chown -R node:node /srv/files
RUN chmod +x /srv/docker-entrypoint.sh

USER node
EXPOSE 3000
ENTRYPOINT ["/usr/bin/tini", "--", "/srv/docker-entrypoint.sh"]
CMD ["server"]
