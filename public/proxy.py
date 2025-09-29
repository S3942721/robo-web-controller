#!/usr/bin/env python2
"""
Pepper Robot Tablet Proxy Service with File-Based Runtime Updates
Monitors a configuration file for changes and updates target without restart
"""

import BaseHTTPServer
import urllib2
import socket
import threading
import select
import sys
import time
import signal
import os
import logging
import json
from datetime import datetime

class FileConfigMonitor:
    """Monitors configuration file for changes"""
    
    def __init__(self, proxy_instance, config_file='/etc/pepper-proxy/runtime.json'):
        self.proxy_instance = proxy_instance
        self.config_file = config_file
        self.logger = proxy_instance.logger
        self.running = False
        self.last_mtime = 0
        
        # Ensure config directory exists
        config_dir = os.path.dirname(config_file)
        if not os.path.exists(config_dir):
            try:
                os.makedirs(config_dir)
            except OSError:
                pass  # Directory might exist now
        
    def start(self):
        """Start monitoring configuration file"""
        self.running = True
        
        # Create initial config file if it doesn't exist
        self._write_initial_config()
        
        # Start monitoring thread
        monitor_thread = threading.Thread(target=self._monitor_loop)
        monitor_thread.daemon = True
        monitor_thread.start()
        
        self.logger.info("Configuration file monitor started: %s", self.config_file)
    
    def stop(self):
        """Stop monitoring"""
        self.running = False
    
    def _write_initial_config(self):
        """Write initial configuration file"""
        config = {
            'target_host': self.proxy_instance.target_host,
            'target_port': self.proxy_instance.target_port,
            'last_updated': time.time(),
            'updated_by': 'system_init'
        }
        
        try:
            with open(self.config_file, 'w') as f:
                json.dump(config, f, indent=2)
            self.last_mtime = os.path.getmtime(self.config_file)
            self.logger.info("Initial configuration written to: %s", self.config_file)
        except Exception as e:
            self.logger.error("Failed to write initial config: %s", e)
    
    def _monitor_loop(self):
        """Monitor configuration file for changes"""
        while self.running:
            try:
                if os.path.exists(self.config_file):
                    current_mtime = os.path.getmtime(self.config_file)
                    
                    if current_mtime != self.last_mtime:
                        self.logger.info("Configuration file changed, reloading...")
                        self._load_config()
                        self.last_mtime = current_mtime
                
                time.sleep(1)  # Check every second
                
            except Exception as e:
                self.logger.error("Config monitor error: %s", e)
                time.sleep(5)  # Wait longer on error
    
    def _load_config(self):
        """Load configuration from file"""
        try:
            with open(self.config_file, 'r') as f:
                config = json.load(f)
            
            new_target = config.get('target_host')
            new_port = config.get('target_port', self.proxy_instance.target_port)
            
            if new_target and new_target != self.proxy_instance.target_host:
                old_target = self.proxy_instance.target_host
                self.proxy_instance.target_host = new_target
                self.logger.info("Target host updated: %s -> %s", old_target, new_target)
            
            if new_port != self.proxy_instance.target_port:
                old_port = self.proxy_instance.target_port
                self.proxy_instance.target_port = new_port
                self.logger.info("Target port updated: %s -> %s", old_port, new_port)
                
        except Exception as e:
            self.logger.error("Failed to load config: %s", e)
    
    def update_config(self, target_host=None, target_port=None, updated_by='unknown'):
        """Update configuration file"""
        try:
            # Read current config or create new
            config = {}
            if os.path.exists(self.config_file):
                try:
                    with open(self.config_file, 'r') as f:
                        config = json.load(f)
                except:
                    pass  # Use empty config if file is corrupted
            
            # Update values
            if target_host is not None:
                config['target_host'] = target_host
            if target_port is not None:
                config['target_port'] = target_port
            
            config['last_updated'] = time.time()
            config['updated_by'] = updated_by
            
            # Write config
            with open(self.config_file, 'w') as f:
                json.dump(config, f, indent=2)
            
            self.logger.info("Configuration updated by: %s", updated_by)
            return True
            
        except Exception as e:
            self.logger.error("Failed to update config: %s", e)
            return False


class PepperTabletProxy:
    def __init__(self, tablet_ip='198.18.0.1', tablet_port=3000, 
                 target_host=None, target_port=3000):
        self.tablet_ip = tablet_ip
        self.tablet_port = tablet_port
        self.target_port = target_port
        self.server = None
        self.running = False
        self.config_monitor = None
        
        # Setup logging first
        log_level = os.environ.get('PEPPER_PROXY_LOG_LEVEL', 'INFO')
        numeric_level = getattr(logging, log_level.upper(), logging.INFO)
        
        logging.basicConfig(
            level=numeric_level,
            format='%(asctime)s - %(levelname)s - %(message)s',
            handlers=[
                logging.FileHandler('/var/log/pepper_tablet_proxy.log'),
                logging.StreamHandler()
            ]
        )
        self.logger = logging.getLogger(__name__)
        
        # Get target host from environment first, then fallback to parameter/config
        self.target_host = self._get_target_host(target_host)
        self.logger.info("Initial target host: %s", self.target_host)
        
        # Initialize configuration monitor
        self.config_monitor = FileConfigMonitor(self)
    
    def _get_target_host(self, fallback_host):
        """Get target host from environment variable or fallback"""
        target_host = os.environ.get('PEPPER_PROXY_TARGET_HOST')
        if target_host:
            self.logger.info("Using target host from environment: %s", target_host)
            return target_host
        elif fallback_host:
            self.logger.info("Using target host from parameter: %s", fallback_host)
            return fallback_host
        else:
            # Final fallback
            self.logger.info("Using default target host: 10.0.0.22")
            return '10.0.0.22'
    
    def start(self):
        """Start the proxy server"""
        try:
            # Start configuration monitor first
            self.config_monitor.start()
            
            self.server = BaseHTTPServer.HTTPServer(
                (self.tablet_ip, self.tablet_port), 
                lambda *args: ProxyHandler(self, *args)
            )
            self.running = True
            
            self.logger.info("Pepper Tablet Proxy started")
            self.logger.info("Listening on: http://%s:%d", self.tablet_ip, self.tablet_port)
            self.logger.info("Proxying to: http://%s:%d", self.target_host, self.target_port)
            self.logger.info("Runtime config file: %s", self.config_monitor.config_file)
            
            # Handle shutdown gracefully
            signal.signal(signal.SIGTERM, self._signal_handler)
            signal.signal(signal.SIGINT, self._signal_handler)
            signal.signal(signal.SIGHUP, self._reload_handler)
            
            self.server.serve_forever()
            
        except Exception as e:
            self.logger.error("Failed to start proxy: %s", e)
            sys.exit(1)
    
    def stop(self):
        """Stop the proxy server"""
        if self.server and self.running:
            self.logger.info("Stopping Pepper Tablet Proxy...")
            self.running = False
            if self.config_monitor:
                self.config_monitor.stop()
            self.server.shutdown()
            self.server.server_close()
            self.logger.info("Proxy stopped")
    
    def _signal_handler(self, signum, frame):
        """Handle shutdown signals"""
        self.logger.info("Received signal %d, shutting down...", signum)
        self.stop()
    
    def _reload_handler(self, signum, frame):
        """Handle reload signal"""
        self.logger.info("Received SIGHUP - configuration updates handled via file monitoring")
        self.logger.info("Current target: %s", self.target_host)
        self.logger.info("Config file: %s", self.config_monitor.config_file)


class ProxyHandler(BaseHTTPServer.BaseHTTPRequestHandler):
    def __init__(self, proxy_instance, *args):
        self.proxy_instance = proxy_instance
        self.logger = proxy_instance.logger
        
        try:
            BaseHTTPServer.BaseHTTPRequestHandler.__init__(self, *args)
        except Exception as e:
            if "Broken pipe" not in str(e) and "Connection reset by peer" not in str(e):
                self.logger.debug("Connection error during initialization: %s", e)
    
    def do_GET(self):
        self._handle_request('GET')
    
    def do_POST(self):
        self._handle_request('POST')
    
    def do_PUT(self):
        self._handle_request('PUT')
    
    def do_DELETE(self):
        self._handle_request('DELETE')
    
    def do_HEAD(self):
        self._handle_request('HEAD')
    
    def _handle_request(self, method):
        """Handle HTTP requests with WebSocket upgrade support"""
        
        try:
            # Get current target (may have been updated via file)
            current_target = self.proxy_instance.target_host
            target_port = self.proxy_instance.target_port
            
            # Check for WebSocket upgrade
            if (self.headers.get('upgrade', '').lower() == 'websocket' and 
                self.headers.get('connection', '').lower().find('upgrade') != -1):
                self._handle_websocket_upgrade(current_target, target_port)
                return
            
            # Handle regular HTTP request
            target_url = "http://%s:%d%s" % (current_target, target_port, self.path)
            
            # Prepare request
            if method in ['POST', 'PUT']:
                content_length = int(self.headers.get('Content-Length', 0))
                post_data = self.rfile.read(content_length) if content_length > 0 else None
                req = urllib2.Request(target_url, data=post_data)
            else:
                req = urllib2.Request(target_url)
            
            # Set request method for non-GET requests
            if method != 'GET':
                req.get_method = lambda: method
            
            # Copy headers (excluding problematic ones)
            skip_headers = ['host', 'connection', 'content-length']
            for header, value in self.headers.items():
                if header.lower() not in skip_headers:
                    req.add_header(header, value)
            
            # Add cache control
            req.add_header('Cache-Control', 'no-cache, no-store, must-revalidate')
            req.add_header('Pragma', 'no-cache')
            
            # Make request with timeout
            response = urllib2.urlopen(req, timeout=10)
            content = response.read() if method != 'HEAD' else ''
            
            # Send response
            self.send_response(200)
            
            # Copy response headers with cache control
            for header, value in response.info().items():
                if header.lower() not in ['connection', 'transfer-encoding']:
                    self.send_header(header, value)
            
            # Force no-cache headers
            self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
            self.send_header('Pragma', 'no-cache')
            self.send_header('Expires', '0')
            
            if content:
                self.send_header('Content-Length', str(len(content)))
            
            self.end_headers()
            
            if method != 'HEAD' and content:
                self.wfile.write(content)
            
            # Log successful request (debug level to reduce spam)
            self.logger.debug("%s %s -> %d (%d bytes) [target: %s]", 
                            method, self.path, response.getcode(), len(content), current_target)
            
        except socket.error as e:
            if e.errno in [32, 104]:  # Broken pipe, Connection reset by peer
                self.logger.debug("Client disconnected: %s %s", method, self.path)
            else:
                self.logger.warning("Socket error for %s %s: %s", method, self.path, e)
        except urllib2.HTTPError as e:
            self.logger.warning("HTTP Error %d for %s %s", e.code, method, self.path)
            try:
                self.send_response(e.code)
                self.end_headers()
                if method != 'HEAD':
                    self.wfile.write("HTTP Error: %d" % e.code)
            except:
                pass
        except Exception as e:
            self.logger.error("Proxy error for %s %s: %s", method, self.path, e)
            try:
                self.send_response(500)
                self.end_headers()
                if method != 'HEAD':
                    self.wfile.write("Proxy Error: %s" % str(e))
            except:
                pass
    
    def _handle_websocket_upgrade(self, target_host, target_port):
        """Handle WebSocket upgrade requests"""
        self.logger.info("WebSocket upgrade request: %s [target: %s]", self.path, target_host)
        
        try:
            # Connect to target server
            target_socket = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            target_socket.settimeout(10)
            target_socket.connect((target_host, target_port))
            
            # Forward upgrade request
            request_lines = ['%s %s HTTP/1.1' % (self.command, self.path)]
            
            for header, value in self.headers.items():
                if header.lower() == 'host':
                    request_lines.append('Host: %s:%d' % (target_host, target_port))
                else:
                    request_lines.append('%s: %s' % (header, value))
            
            request_lines.extend(['', ''])
            target_socket.send('\r\n'.join(request_lines))
            
            # Get response
            response = target_socket.recv(4096)
            self.wfile.write(response)
            
            # Start bidirectional proxy
            client_socket = self.request
            self._proxy_websocket_data(client_socket, target_socket)
            
        except Exception as e:
            self.logger.error("WebSocket upgrade failed: %s", e)
            try:
                self.send_error(500, "WebSocket upgrade failed")
            except:
                pass
    
    def _proxy_websocket_data(self, client_socket, target_socket):
        """Proxy WebSocket data bidirectionally"""
        def proxy_direction(source, dest, name):
            try:
                while True:
                    ready = select.select([source], [], [], 1.0)
                    if ready[0]:
                        data = source.recv(4096)
                        if not data:
                            break
                        dest.send(data)
            except Exception as e:
                self.logger.debug("WebSocket proxy %s ended: %s", name, e)
            finally:
                try:
                    source.close()
                    dest.close()
                except:
                    pass
        
        # Start proxy threads
        client_to_server = threading.Thread(
            target=proxy_direction, 
            args=(client_socket, target_socket, "client->server")
        )
        server_to_client = threading.Thread(
            target=proxy_direction, 
            args=(target_socket, client_socket, "server->client")
        )
        
        client_to_server.daemon = True
        server_to_client.daemon = True
        
        client_to_server.start()
        server_to_client.start()
        
        # Wait for both directions to complete
        client_to_server.join()
        server_to_client.join()
        
        self.logger.debug("WebSocket connection closed: %s", self.path)
    
    def log_message(self, format, *args):
        """Override default logging to reduce spam"""
        pass


def main():
    """Main entry point"""
    import argparse
    
    parser = argparse.ArgumentParser(description='Pepper Robot Tablet Proxy Service with File-Based Updates')
    parser.add_argument('--tablet-ip', default='198.18.0.1', 
                       help='Tablet interface IP (default: 198.18.0.1)')
    parser.add_argument('--tablet-port', type=int, default=3000,
                       help='Tablet interface port (default: 3000)')
    parser.add_argument('--target-host', 
                       help='Target server host (overrides environment)')
    parser.add_argument('--target-port', type=int, default=3000,
                       help='Target server port (default: 3000)')
    parser.add_argument('--daemon', action='store_true',
                       help='Run as daemon process')
    
    args = parser.parse_args()
    
    # Create proxy instance
    proxy = PepperTabletProxy(
        tablet_ip=args.tablet_ip,
        tablet_port=args.tablet_port,
        target_host=args.target_host,
        target_port=args.target_port
    )
    
    if args.daemon:
        # Daemonize process
        try:
            pid = os.fork()
            if pid > 0:
                sys.exit(0)
        except OSError as e:
            sys.stderr.write("Fork failed: %s\n" % e)
            sys.exit(1)
        
        os.chdir("/")
        os.setsid()
        os.umask(0)
    
    # Start proxy
    proxy.start()


if __name__ == '__main__':
    main()
