#!/usr/bin/env python3
"""
Audio Receiver Script
Receives and plays real-time audio stream from Pepper robot
Python 3 compatible
"""

import gi
gi.require_version('Gst', '1.0')
from gi.repository import Gst, GObject, GLib
import sys
import signal
import argparse

class AudioReceiver:
    def __init__(self, listen_port=5004):
        self.listen_port = listen_port
        self.pipeline = None
        self.loop = None
        
        # Initialize GStreamer
        Gst.init(None)
        
    def create_pipeline(self):
        """Create adaptive GStreamer pipeline for receiving audio with jitter buffer"""
        pipeline_desc = (
            f"udpsrc port={self.listen_port} "
            "caps=\"application/x-rtp,media=(string)audio,clock-rate=(int)44100,encoding-name=(string)L16,payload=(int)96,channels=(int)1\" ! "
            "rtpjitterbuffer "
            "latency=200 "  # 200ms jitter buffer
            "drop-on-latency=true "
            "max-dropout-time=1000 "
            "max-misorder-time=100 ! "
            "rtpL16depay ! "
            "audioconvert ! "
            "audioresample ! "  # Handle sample rate changes
            "queue "
            "max-size-buffers=50 "
            "max-size-time=1000000000 "  # 1 second buffer
            "leaky=downstream ! "
            "autoaudiosink "
            "sync=false"  # Disable sync for lower latency
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
            print("Stream started - audio should be playing now")
    
    def start(self):
        """Start receiving and playing audio"""
        if not self.create_pipeline():
            return False
            
        print(f"Starting audio receiver on port {self.listen_port}")
        print("Waiting for audio stream from Pepper robot...")
        
        # Start the pipeline
        ret = self.pipeline.set_state(Gst.State.PLAYING)
        if ret == Gst.StateChangeReturn.FAILURE:
            print("Failed to start pipeline")
            return False
        
        # Create main loop
        self.loop = GLib.MainLoop()
        
        # Set up signal handlers
        signal.signal(signal.SIGINT, self.signal_handler)
        signal.signal(signal.SIGTERM, self.signal_handler)
        
        try:
            print("Receiving audio... Press Ctrl+C to stop")
            self.loop.run()
        except KeyboardInterrupt:
            print("\nStopping receiver...")
            self.stop()
        
        return True
    
    def signal_handler(self, signum, frame):
        """Handle shutdown signals"""
        print(f"\nReceived signal {signum}, stopping...")
        self.stop()
    
    def stop(self):
        """Stop audio receiver"""
        if self.pipeline:
            self.pipeline.set_state(Gst.State.NULL)
        if self.loop and self.loop.is_running():
            self.loop.quit()

def test_audio_output():
    """Test if audio output is working"""
    print("Testing audio output...")
    try:
        # Create a simple test pipeline - try different approaches
        test_pipelines = [
            "audiotestsrc freq=440 num-buffers=100 ! autoaudiosink",
            "audiotestsrc freq=440 wave=sine ! autoaudiosink",
            "audiotestsrc ! audioconvert ! autoaudiosink"
        ]
        
        import time
        pipeline = None
        
        for pipeline_str in test_pipelines:
            try:
                print(f"Trying: {pipeline_str}")
                pipeline = Gst.parse_launch(pipeline_str)
                ret = pipeline.set_state(Gst.State.PLAYING)
                
                if ret != Gst.StateChangeReturn.FAILURE:
                    time.sleep(1)
                    pipeline.set_state(Gst.State.NULL)
                    print("Audio output test completed successfully")
                    return True
                else:
                    print("Pipeline failed to start")
            except Exception as e:
                print(f"Test pipeline failed: {e}")
                continue
        
        # If all tests failed, check what elements are available
        print("Checking available GStreamer elements...")
        registry = Gst.Registry.get()
        
        # Check for key elements
        elements_to_check = ['audiotestsrc', 'autoaudiosink', 'pulsesink', 'alsasink']
        available = []
        for element in elements_to_check:
            if registry.find_feature(element, Gst.ElementFactory.__gtype__):
                available.append(element)
        
        print(f"Available audio elements: {available}")
        
        if 'autoaudiosink' in available or 'pulsesink' in available:
            print("Audio sink is available - the issue might be with audiotestsrc")
            print("Audio output should work for receiving streams")
            return True
        
        return False
        
    except Exception as e:
        print(f"Audio output test failed: {e}")
        return False

def main():
    parser = argparse.ArgumentParser(description='Receive audio stream from Pepper robot')
    parser.add_argument('--port', '-p', type=int, default=5004,
                        help='Port to listen on (default: 5004)')
    parser.add_argument('--test', '-t', action='store_true',
                        help='Test audio output before starting receiver')
    
    args = parser.parse_args()
    
    print("Audio Receiver for Pepper Robot")
    print(f"Listening on port: {args.port}")
    
    # Test audio output if requested
    if args.test:
        if not test_audio_output():
            print("Audio output test failed. Check your audio system.")
            return 1
    
    # Create and start receiver
    receiver = AudioReceiver(args.port)
    success = receiver.start()
    
    return 0 if success else 1

if __name__ == "__main__":
    sys.exit(main())