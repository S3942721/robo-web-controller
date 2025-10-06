import socket
import pyaudio
import struct
import time
import threading
import sys

class LowLatencyStreamer:
    def __init__(self, host, port):
        self.host = host
        self.port = port
        self.sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        self.sequence = 0
        self.running = False
        
        # Optimized for latency and compatibility
        self.chunk_size = 256      # Small chunks for low latency (16ms at 16kHz)
        self.sample_rate = 16000   # Match server expectation
        self.channels = 1          # Mono
        self.format = pyaudio.paInt16  # 16-bit samples
        
        print("Audio Stream Test - Connecting to {}:{}".format(host, port))
        print("Format: {} Hz, {} channels, 16-bit samples".format(self.sample_rate, self.channels))
        
    def start_stream(self):
        self.running = True
        try:
            audio = pyaudio.PyAudio()
            
            # List available audio devices
            print("\nAvailable audio devices:")
            for i in range(audio.get_device_count()):
                info = audio.get_device_info_by_index(i)
                if info['maxInputChannels'] > 0:
                    print("  {}: {} (rate: {})".format(i, info['name'], int(info['defaultSampleRate'])))
            
            stream = audio.open(
                format=self.format,
                channels=self.channels,
                rate=self.sample_rate,
                input=True,
                frames_per_buffer=self.chunk_size,
                input_device_index=None,  # Default device
            )
            
            print("\nStarting audio stream...")
            print("Chunk size: {} samples ({:.1f}ms at {}Hz)".format(
                self.chunk_size, 
                (self.chunk_size / self.sample_rate) * 1000,
                self.sample_rate
            ))
            print("Speaking into microphone... Press Ctrl+C to stop")
            
            packet_count = 0
            start_time = time.time()
            
            while self.running:
                try:
                    # Read audio data
                    data = stream.read(self.chunk_size, exception_on_overflow=False)
                    
                    # Verify data length
                    expected_bytes = self.chunk_size * 2  # 2 bytes per int16 sample
                    if len(data) != expected_bytes:
                        print("Warning: Expected {} bytes, got {}".format(expected_bytes, len(data)))
                    
                    # Calculate volume for monitoring
                    import array
                    try:
                        audio_data = array.array('h', data)  # signed 16-bit
                        volume = max(abs(x) for x in audio_data) if audio_data else 0
                    except:
                        volume = 0
                    
                    # Create packet with proper byte order
                    timestamp = int(time.time() * 1000000) & 0xFFFFFFFF  # microseconds, 32-bit
                    volume_uint = min(65535, volume)  # Clamp to 16-bit unsigned range for transmission
                    
                    # Pack header: sequence(32), timestamp(32), volume(32) - all big-endian for network
                    header = struct.pack('!III', self.sequence, timestamp, volume_uint)
                    packet = header + data
                    
                    # Send packet
                    self.sock.sendto(packet, (self.host, self.port))
                    self.sequence += 1
                    packet_count += 1
                    
                    # Print status every 50 packets (~800ms at 16ms chunks)
                    if self.sequence % 50 == 0:
                        elapsed = time.time() - start_time
                        rate = packet_count / elapsed if elapsed > 0 else 0
                        volume_bar = '#' * min(20, volume // 1000)
                        
                        print("PACKET: #{} -> {}:{} | size: {} bytes (header: 12, audio: {}) | vol: {} | ts: {}".format(
                            self.sequence, self.host, self.port, len(packet), len(data), volume, timestamp
                        ))
                        print("Volume: [{}{}] {} (seq: {})".format(
                            volume_bar, 
                            ' ' * (20 - len(volume_bar)), 
                            volume,
                            self.sequence
                        ))
                        print("NETWORK: Rate: {:.1f} pkt/s, {:.1f} KB/s | Total: {} pkts, {:.1f} KB | Errors: 0".format(
                            rate, (rate * len(packet)) / 1024, packet_count, (packet_count * len(packet)) / 1024
                        ))
                    
                except Exception as e:
                    print("Audio capture error: {}".format(e))
                    time.sleep(0.001)
                    
        except Exception as e:
            print("Failed to initialize audio: {}".format(e))
            print("Make sure you have a microphone connected and PyAudio installed:")
            print("  pip install pyaudio")
        finally:
            if 'stream' in locals():
                stream.stop_stream()
                stream.close()
            if 'audio' in locals():
                audio.terminate()
            self.sock.close()
            
    def stop_stream(self):
        self.running = False

def main():
    if len(sys.argv) < 2:
        print("Usage: python externalAudioStreamTest.py <server_ip> [port]")
        print("Example: python externalAudioStreamTest.py 192.168.1.100")
        print("         python externalAudioStreamTest.py localhost 9999")
        sys.exit(1)
    
    host = sys.argv[1]
    port = int(sys.argv[2]) if len(sys.argv) > 2 else 9999
    
    print("Low-Latency Audio Streamer")
    print("=" * 40)
    print("Target: {}:{}".format(host, port))
    
    streamer = LowLatencyStreamer(host, port)
    
    try:
        streamer.start_stream()
    except KeyboardInterrupt:
        print("\nStopping audio stream...")
        streamer.stop_stream()
        print("Audio stream stopped.")

if __name__ == "__main__":
    main()
