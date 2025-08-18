#!/usr/bin/env python3
"""
Virtual Microphone Audio Receiver
Receives audio from Pepper robot and creates a virtual microphone device
that can be used by web applications
"""

import gi
gi.require_version('Gst', '1.0')
from gi.repository import Gst, GObject, GLib
import sys
import signal
import argparse
import subprocess
import os
import time

class VirtualMicReceiver:
    def __init__(self, listen_port=5004, virtual_mic_name="PepperRobotMic"):
        self.listen_port = listen_port
        self.virtual_mic_name = virtual_mic_name
        self.pipeline = None
        self.loop = None
        self.pulse_module_id = None
        
        # Initialize GStreamer
        Gst.init(None)
        
    def create_virtual_microphone(self):
        """Create a virtual microphone using PulseAudio"""
        try:
            print(f"Creating virtual microphone: {self.virtual_mic_name}")
            
            # Create a null sink (virtual audio device)
            cmd = [
                "pactl", "load-module", "module-null-sink",
                f"sink_name={self.virtual_mic_name}",
                f"sink_properties=device.description='{self.virtual_mic_name}'"
            ]
            
            result = subprocess.run(cmd, capture_output=True, text=True)
            if result.returncode == 0:
                self.pulse_module_id = result.stdout.strip()
                print(f"Virtual microphone created with module ID: {self.pulse_module_id}")
                
                # The virtual microphone will be available as {virtual_mic_name}.monitor
                print(f"Virtual microphone source: {self.virtual_mic_name}.monitor")
                return True
            else:
                print(f"Failed to create virtual microphone: {result.stderr}")
                return False
                
        except Exception as e:
            print(f"Error creating virtual microphone: {e}")
            return False
    
    def remove_virtual_microphone(self):
        """Remove the virtual microphone"""
        if self.pulse_module_id:
            try:
                cmd = ["pactl", "unload-module", self.pulse_module_id]
                subprocess.run(cmd, capture_output=True)
                print("Virtual microphone removed")
            except Exception as e:
                print(f"Error removing virtual microphone: {e}")
    
    def create_pipeline(self):
        """Create GStreamer pipeline for receiving audio and sending to virtual mic"""
        # Pipeline receives RTP audio and sends it to the PulseAudio sink
        pipeline_desc = (
            f"udpsrc port={self.listen_port} "
            "caps=\"application/x-rtp,media=(string)audio,clock-rate=(int)44100,encoding-name=(string)L16,encoding-params=(string)2,channels=(int)2,payload=(int)96\" ! "
            "rtpL16depay ! "
            "audioconvert ! "
            "audio/x-raw,rate=44100,channels=1,format=S16LE ! "  # Convert to mono for voice
            f"pulsesink device={self.virtual_mic_name}"
        )
        
        print(f"Creating pipeline: {pipeline_desc}")
        
        try:
            self.pipeline = Gst.parse_launch(pipeline_desc)
        except Exception as e:
            print(f"Error creating pipeline: {e}")
            return False
            
        # Set up message handling
        bus = self.pipeline.get_bus()
        bus.add_signal_watch()
        bus.connect("message", self.on_message)
        
        return True
    
    def on_message(self, bus, message):
        """Handle GStreamer messages"""
        if message.type == Gst.MessageType.ERROR:
            err, debug = message.parse_error()
            print(f"Error: {err}")
            print(f"Debug: {debug}")
            self.stop()
        elif message.type == Gst.MessageType.EOS:
            print("End of stream")
            self.stop()
        elif message.type == Gst.MessageType.STATE_CHANGED:
            if message.src == self.pipeline:
                old_state, new_state, pending_state = message.parse_state_changed()
                print(f"Pipeline state changed from {old_state.value_nick} to {new_state.value_nick}")
        elif message.type == Gst.MessageType.STREAM_START:
            print("Stream started - audio is now being fed to virtual microphone")
            self.show_usage_instructions()
    
    def show_usage_instructions(self):
        """Show instructions for using the virtual microphone"""
        print("\n" + "="*60)
        print("VIRTUAL MICROPHONE READY!")
        print("="*60)
        print(f"Device name: {self.virtual_mic_name}.monitor")
        print("\nTo use in your web application:")
        print("1. Look for audio input devices")
        print(f"2. Select '{self.virtual_mic_name}' or similar")
        print("3. The robot's audio will appear as microphone input")
        print("\nTo test with command line:")
        print(f"  arecord -D pulse -d 5 -f cd test.wav")
        print(f"  pactl list sources | grep -A 5 {self.virtual_mic_name}")
        print("="*60 + "\n")
    
    def start(self):
        """Start the virtual microphone receiver"""
        # Create virtual microphone first
        if not self.create_virtual_microphone():
            return False
            
        # Wait a moment for PulseAudio to register the device
        time.sleep(1)
            
        if not self.create_pipeline():
            self.remove_virtual_microphone()
            return False
            
        print(f"Starting virtual microphone receiver on port {self.listen_port}")
        print("Waiting for audio stream from Pepper robot...")
        
        # Start the pipeline
        ret = self.pipeline.set_state(Gst.State.PLAYING)
        if ret == Gst.StateChangeReturn.FAILURE:
            print("Failed to start pipeline")
            self.remove_virtual_microphone()
            return False
        
        # Create main loop
        self.loop = GLib.MainLoop()
        
        # Set up signal handlers
        signal.signal(signal.SIGINT, self.signal_handler)
        signal.signal(signal.SIGTERM, self.signal_handler)
        
        try:
            print("Virtual microphone active... Press Ctrl+C to stop")
            self.loop.run()
        except KeyboardInterrupt:
            print("\nStopping virtual microphone...")
            self.stop()
        
        return True
    
    def signal_handler(self, signum, frame):
        """Handle shutdown signals"""
        print(f"\nReceived signal {signum}, stopping...")
        self.stop()
    
    def stop(self):
        """Stop the virtual microphone receiver"""
        if self.pipeline:
            self.pipeline.set_state(Gst.State.NULL)
        if self.loop and self.loop.is_running():
            self.loop.quit()
        
        # Clean up virtual microphone
        self.remove_virtual_microphone()

def list_audio_devices():
    """List available audio devices"""
    print("Available PulseAudio sources:")
    try:
        result = subprocess.run(["pactl", "list", "sources"], capture_output=True, text=True)
        if result.returncode == 0:
            print(result.stdout)
        else:
            print("Failed to list audio sources")
    except Exception as e:
        print(f"Error listing devices: {e}")

def main():
    parser = argparse.ArgumentParser(description='Create virtual microphone from Pepper robot audio')
    parser.add_argument('--port', '-p', type=int, default=5004,
                        help='Port to listen on (default: 5004)')
    parser.add_argument('--name', '-n', default='PepperRobotMic',
                        help='Virtual microphone name (default: PepperRobotMic)')
    parser.add_argument('--list', '-l', action='store_true',
                        help='List available audio devices and exit')
    
    args = parser.parse_args()
    
    if args.list:
        list_audio_devices()
        return 0
    
    print("Virtual Microphone Receiver for Pepper Robot")
    print(f"Listening on port: {args.port}")
    print(f"Virtual microphone name: {args.name}")
    
    # Check if PulseAudio is available
    try:
        subprocess.run(["pactl", "info"], capture_output=True, check=True)
    except (subprocess.CalledProcessError, FileNotFoundError):
        print("Error: PulseAudio is not available or not running")
        print("Make sure PulseAudio is installed and running")
        return 1
    
    # Create and start virtual microphone receiver
    receiver = VirtualMicReceiver(args.port, args.name)
    success = receiver.start()
    
    return 0 if success else 1

if __name__ == "__main__":
    sys.exit(main())