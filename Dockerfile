FROM ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive
ENV TZ=Etc/UTC

# Force IPv4 (avoids IPv6 timeouts)
RUN echo 'Acquire::ForceIPv4 "true";' > /etc/apt/apt.conf.d/99force-ipv4

# Replace Ubuntu mirrors safely (HTTP version)
RUN bash -c 'shopt -s nullglob; \
  for f in /etc/apt/sources.list /etc/apt/sources.list.d/*.list; do \
    [ -f "$f" ] && sed -i "s|http://archive.ubuntu.com/ubuntu|http://mirror.leaseweb.com/ubuntu|g" "$f"; \
    [ -f "$f" ] && sed -i "s|http://security.ubuntu.com/ubuntu|http://mirror.leaseweb.com/ubuntu|g" "$f"; \
  done'

# Install CA certificates first, then other essential packages
RUN apt-get update && apt-get install -y ca-certificates tzdata git wget curl \
 && rm -rf /var/lib/apt/lists/*

# Set timezone
RUN ln -fs /usr/share/zoneinfo/$TZ /etc/localtime \
  && dpkg-reconfigure --frontend noninteractive tzdata

RUN apt-get update && apt-get install -y \
    git wget unzip software-properties-common apt-transport-https gnupg ca-certificates curl

RUN curl -fsSL https://deb.nodesource.com/setup_18.x | bash - \
  && apt-get install -y nodejs


# Install Microsoft packages repo
RUN wget https://packages.microsoft.com/config/ubuntu/20.04/packages-microsoft-prod.deb -O packages-microsoft-prod.deb \
  && dpkg -i packages-microsoft-prod.deb \
  && rm packages-microsoft-prod.deb

RUN apt-get update

# Install .NET 8 SDK (preview or stable if available)
RUN apt-get install -y dotnet-sdk-8.0

# Clone Il2CppDumper repo
RUN git clone https://github.com/Perfare/Il2CppDumper.git /app/Il2CppDumper
WORKDIR /app/Il2CppDumper

# Remove the interactive "Press any key" block
RUN sed -i '/if (config.RequireAnyKey)/,/}/d' Il2CppDumper/Program.cs

# Build the project
RUN dotnet build Il2CppDumper.sln -c Release

# After building Il2CppDumper project
WORKDIR /app

# Copy Node.js server files into container
COPY server.js app.js package*.json ./
COPY config ./config
COPY controllers ./controllers
COPY services ./services
COPY utils ./utils
COPY middleware ./middleware
COPY routes ./routes
COPY views ./views
COPY .env ./.env

# Install Node.js dependencies
RUN npm install

# Create necessary directories
RUN mkdir -p uploads/temp uploads/results logs

# Set proper permissions
RUN chmod +x server.js

# Expose the port
EXPOSE 5555

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:5555/api/health || exit 1

# Run Node.js server
CMD ["node", "server.js"]