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
        
        # Optimized for latency
        self.chunk_size = 256      # Very small chunks (16ms at 16kHz)
        self.sample_rate = 16000   # Good quality/bandwidth balance
        self.channels = 1
        
        print("Audio Stream Test - Connecting to {}:{}".format(host, port))
        
    def start_stream(self):
        self.running = True
        try:
            audio = pyaudio.PyAudio()
            
            # List available audio devices
            print("\nAvailable audio devices:")
            for i in range(audio.get_device_count()):
                info = audio.get_device_info_by_index(i)
                if info['maxInputChannels'] > 0:
                    print("  {}: {}".format(i, info['name']))
            
            stream = audio.open(
                format=pyaudio.paInt16,
                channels=self.channels,
                rate=self.sample_rate,
                input=True,
                frames_per_buffer=self.chunk_size,
                input_device_index=None,  # Default device
            )
            
            print("\nStarting low-latency audio stream...")
            print("Speaking into microphone... Press Ctrl+C to stop")
            
            while self.running:
                try:
                    data = stream.read(self.chunk_size, exception_on_overflow=False)
                    
                    # Calculate simple volume level for testing
                    import array
                    audio_data = array.array('h', data)
                    volume = max(audio_data) if audio_data else 0
                    
                    # Minimal packet: sequence + timestamp + volume + audio
                    timestamp = int(time.time() * 1000000)  # microseconds
                    # Ensure values are within unsigned int range (0 to 4294967295)
                    timestamp = timestamp & 0xFFFFFFFF  # Keep only lower 32 bits
                    volume = max(0, min(4294967295, abs(volume)))  # Clamp to valid range
                    
                    packet = struct.pack('!III', self.sequence, timestamp, volume) + data
                    
                    self.sock.sendto(packet, (self.host, self.port))
                    self.sequence += 1
                    
                    # Print volume indicator every 50 packets (~800ms)
                    if self.sequence % 50 == 0:
                        volume_bar = '#' * min(20, volume // 1000)
                        print("Volume: [{}{}] {}".format(
                            volume_bar, 
                            ' ' * (20 - len(volume_bar)), 
                            volume
                        ))
                    
                except Exception as e:
                    print("Audio error: {}".format(e))
                    time.sleep(0.001)
                    
        except Exception as e:
            print("Failed to initialize audio: {}".format(e))
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
    
    streamer = LowLatencyStreamer(host, port)
    
    try:
        streamer.start_stream()
    except KeyboardInterrupt:
        print("\nStopping audio stream...")
        streamer.stop_stream()
        print("Audio stream stopped.")

if __name__ == "__main__":
    main()
