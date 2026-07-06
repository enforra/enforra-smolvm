FROM node:22-slim

# Set working directory inside the VM container
WORKDIR /app

# Copy package configuration and install production dependencies
COPY package.json ./
RUN npm install --omit=dev

# Copy the agent script and local Enforra policy file
COPY enforra-run.js policy.yaml ./

# Make the agent script executable and symlink to PATH
RUN chmod +x enforra-run.js && ln -s /app/enforra-run.js /usr/local/bin/enforra-run

# Default command displays the help/usage guide
CMD ["enforra-run", "--help"]

