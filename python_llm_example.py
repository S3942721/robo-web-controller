"""
ASR to LLM Integration Script
Combines real-time speech recognition with LLM communication.
When a complete utterance is detected, it's sent to the LLM for processing.
"""

import asyncio
import json
import os
import sys
import argparse
import logging
from typing import Optional, Dict, Any, List
import time
import threading
import queue
from datetime import datetime
import re
import copy
import pyaudio as pa
import numpy as np
import torch
from collections import deque

# Add EOU detection imports
import onnxruntime as ort
from transformers import AutoTokenizer
from huggingface_hub import hf_hub_download

from omegaconf import OmegaConf, open_dict

import nemo.collections.asr as nemo_asr
import nemo.collections.nlp as nemo_nlp
from nemo.collections.asr.models.ctc_bpe_models import EncDecCTCModelBPE
from nemo.collections.asr.parts.utils.rnnt_utils import Hypothesis

# AWS SDK imports for Bedrock
try:
    import boto3
    from botocore.exceptions import ClientError, NoCredentialsError
    AWS_AVAILABLE = True
except ImportError:
    AWS_AVAILABLE = False
    print("Warning: boto3 not available. AWS Bedrock integration disabled.")

# HTTP/WebSocket client libraries
import aiohttp
import websockets

# Import the lambda client
from lambda_llm_client import LambdaLLMClient, LambdaWebSocketClient

# Constants from the VAD EOU file
SAMPLE_RATE = 16000  # Hz
ENCODER_STEP_LENGTH = 80  # ms for FastConformer models

# Available ASR models
AVAILABLE_ASR_MODELS = [
    "stt_en_fastconformer_hybrid_large_streaming_multi",
    "stt_en_fastconformer_hybrid_large_streaming_80ms", 
    "stt_en_fastconformer_hybrid_large_streaming_480ms",
    "stt_en_fastconformer_hybrid_large_streaming_1040ms"
]

# Available punctuation models
AVAILABLE_PUNCT_MODELS = [
    "punctuation_en_bert",
    "punctuation_en_distilbert",
]

class EndOfUtteranceDetector:
    def __init__(self, quiet_mode=False):
        """Initialize the TurnSense end-of-utterance detection model"""
        self.quiet_mode = quiet_mode
        self.model_id = "latishab/turnsense"
        self.threshold = 0.75  # Reduced from 0.8 to be more sensitive
        
        # Add additional criteria to reduce false positives
        self.min_words_for_eou = 5  # Reduced from 8 to 5 words
        self.confirmation_needed = 2  # Require 2 consecutive positive detections
        self.recent_detections = []  # Track recent EOU detections
        
        try:
            if not quiet_mode:
                print("Loading TurnSense EOU detection model...")
            
            # Suppress output during model loading in quiet mode
            if quiet_mode:
                with open(os.devnull, 'w') as devnull:
                    old_stderr = sys.stderr
                    old_stdout = sys.stdout
                    sys.stderr = devnull
                    sys.stdout = devnull
                    try:
                        self._load_model()
                    finally:
                        sys.stderr = old_stderr
                        sys.stdout = old_stdout
            else:
                self._load_model()
                
            if not quiet_mode:
                print("TurnSense EOU model loaded successfully")
                
        except Exception as e:
            if not quiet_mode:
                print(f"Warning: Could not load EOU detection model: {e}")
                print("Continuing without EOU detection...")
            self.tokenizer = None
            self.session = None
    
    def _load_model(self):
        """Load the tokenizer and ONNX model"""
        # Download and load tokenizer
        self.tokenizer = AutoTokenizer.from_pretrained(self.model_id)
        
        # Download and load ONNX model
        model_path = hf_hub_download(repo_id=self.model_id, filename="model_quantized.onnx")
        
        # Initialize ONNX Runtime session
        self.session = ort.InferenceSession(model_path, providers=["CPUExecutionProvider"])
    
    def detect_eou(self, text):
        """
        Detect if the given text represents an end of utterance
        
        Args:
            text: Input text to analyze
            
        Returns:
            bool: True if end of utterance is detected, False otherwise
        """
        if not self.tokenizer or not self.session or not text.strip():
            return False
        
        # Check minimum length requirement
        word_count = len(text.strip().split())
        if word_count < self.min_words_for_eou:
            return False
        
        try:
            # Prepare input in the format expected by TurnSense
            formatted_text = f"<|user|> {text.strip()} <|im_end|>"
            
            # Tokenize
            inputs = self.tokenizer(
                formatted_text,
                padding="max_length",
                max_length=256,
                return_tensors="pt",
                truncation=True
            )
            
            # Run inference
            ort_inputs = {
                'input_ids': inputs['input_ids'].numpy(),
                'attention_mask': inputs['attention_mask'].numpy()
            }
            
            # Get probabilities
            probabilities = self.session.run(None, ort_inputs)[0]
            
            # Extract EOU probability (assuming binary classification where index 1 is EOU)
            eou_probability = float(probabilities[0][1]) if len(probabilities[0]) > 1 else float(probabilities[0][0])
            
            # Track recent detections for confirmation
            is_above_threshold = eou_probability > self.threshold
            self.recent_detections.append(is_above_threshold)
            
            # Keep only recent detections (last 3)
            if len(self.recent_detections) > 3:
                self.recent_detections = self.recent_detections[-3:]
            
            # Require multiple consecutive confirmations
            confirmation_count = sum(self.recent_detections[-self.confirmation_needed:])
            is_eou = (confirmation_count >= self.confirmation_needed and 
                     len(self.recent_detections) >= self.confirmation_needed)
            
            # Additional checks for natural sentence endings
            text_lower = text.strip().lower()
            has_natural_ending = any(text_lower.endswith(ending) for ending in [
                '.', '?', '!', '. thank you', '. thanks', 'that\'s it', 'that is it'
            ])
            
            # Relaxed triggering logic - trigger EOU if:
            # 1. High confidence (> 0.9) regardless of ending, OR
            # 2. Medium confidence (> threshold) AND has natural ending, OR  
            # 3. Medium confidence (> threshold) AND confirmations AND reasonable length
            final_eou = (
                eou_probability > 0.9 or  # Very high confidence
                (is_eou and has_natural_ending) or  # Medium confidence + natural ending
                (is_eou and word_count >= 8)  # Medium confidence + longer utterance
            )
            
            if not self.quiet_mode:
                if final_eou:
                    print(f"[EOU] Detected end of utterance (confidence: {eou_probability:.3f}, words: {word_count}, confirmations: {confirmation_count})")
                elif is_above_threshold:
                    print(f"[EOU] Potential EOU detected but not confirmed (confidence: {eou_probability:.3f}, words: {word_count})")
            
            if not self.quiet_mode:
                print(f"Current EOU probability: {eou_probability}, recent detections: {self.recent_detections}")
            
            # Reset detection history if we actually trigger EOU
            if final_eou:
                self.recent_detections = []
            
            return final_eou
            
        except Exception as e:
            if not self.quiet_mode:
                print(f"EOU detection error: {e}")
            return False

class FrameLevelSpeechDetector:
    def __init__(self, quiet_mode=False):
        """Analyze frame-level speech activity using NeMo VAD model"""
        self.quiet_mode = quiet_mode
        
        # Frame-level analysis parameters
        self.vad_frame_duration = 0.02  # 20ms per VAD frame
        self.analysis_window_seconds = 2.0  # Analyze last 2 seconds (reduced from 3s)
        self.frames_per_analysis_window = int(self.analysis_window_seconds / self.vad_frame_duration)  # 100 frames for 2 seconds
        
        # Rolling window to store frame-level speech detection results
        self.speech_frame_history = deque(maxlen=self.frames_per_analysis_window)
        
        # EOU detection parameters - made more sensitive
        self.speech_proportion_threshold = 0.2  # If less than 20% of frames have speech, consider it silence (increased from 10%)
        self.min_frames_for_eou = int(0.5 / self.vad_frame_duration)  # Need at least 0.5 second of data (reduced from 1s)
        self.speech_probability_threshold = 0.5  # VAD threshold for individual frame speech detection
        
        # Consecutive silence detection for more responsive EOU
        self.consecutive_silence_frames = 0
        self.consecutive_silence_threshold = int(0.8 / self.vad_frame_duration)  # 0.8 seconds of consecutive silence
        
        # Load NeMo VAD model
        try:
            if not quiet_mode:
                print("Loading NeMo VAD model...")
            
            if quiet_mode:
                with open(os.devnull, 'w') as devnull:
                    old_stderr = sys.stderr
                    sys.stderr = devnull
                    try:
                        self.vad_model = nemo_asr.models.EncDecFrameClassificationModel.from_pretrained(
                            model_name="nvidia/frame_vad_multilingual_marblenet_v2.0"
                        )
                    finally:
                        sys.stderr = old_stderr
            else:
                self.vad_model = nemo_asr.models.EncDecFrameClassificationModel.from_pretrained(
                    model_name="nvidia/frame_vad_multilingual_marblenet_v2.0"
                )
            
            # Move to GPU if available
            if torch.cuda.is_available():
                self.vad_model = self.vad_model.cuda()
                if not quiet_mode:
                    print("VAD model moved to GPU")
            
            self.vad_model.eval()
            
            if not quiet_mode:
                print("NeMo VAD model loaded successfully")
                print(f"VAD analysis window: {self.analysis_window_seconds}s ({self.frames_per_analysis_window} frames)")
                
        except Exception as e:
            if not quiet_mode:
                print(f"Warning: Could not load VAD model: {e}")
                print("Falling back to basic frame analysis...")
            self.vad_model = None
        
    def analyze_audio_vad(self, audio_signal):
        """
        Analyze audio using NeMo VAD model to detect speech activity per frame
        
        Args:
            audio_signal: Raw audio signal (numpy array, float32, 16kHz)
            
        Returns:
            list: List of boolean values indicating speech detection for each 20ms frame
        """
        try:
            if self.vad_model is None or len(audio_signal) == 0:
                return []
            
            # Ensure audio is the right format
            if not isinstance(audio_signal, np.ndarray):
                audio_signal = np.array(audio_signal)
            
            if audio_signal.dtype != np.float32:
                audio_signal = audio_signal.astype(np.float32)
            
            # Minimum length check (VAD needs some audio to analyze)
            min_samples = 320  # 20ms at 16kHz
            if len(audio_signal) < min_samples:
                # Pad with zeros if too short
                padding = np.zeros(min_samples - len(audio_signal), dtype=np.float32)
                audio_signal = np.concatenate([audio_signal, padding])
            
            # Convert to tensor and add batch dimension
            input_signal = torch.from_numpy(audio_signal).unsqueeze(0).float()
            input_signal_length = torch.tensor([input_signal.shape[1]]).long()
            
            # Move to same device as model
            device = next(self.vad_model.parameters()).device
            input_signal = input_signal.to(device)
            input_signal_length = input_signal_length.to(device)
            
            # Run VAD inference
            with torch.no_grad():
                vad_outputs = self.vad_model(
                    input_signal=input_signal,
                    input_signal_length=input_signal_length
                )
            
            # Move outputs back to CPU for processing
            if hasattr(vad_outputs, 'cpu'):
                vad_probs = vad_outputs.cpu().numpy()
            else:
                vad_probs = vad_outputs
            
            # Handle VAD output format
            # Shape is typically [batch, time_frames, num_classes] where num_classes=2 for [non-speech, speech]
            if vad_probs.ndim == 3:
                vad_probs = vad_probs.squeeze(0)  # Remove batch dimension -> [time_frames, num_classes]
            
            # Convert probabilities to binary speech detection for each frame
            if vad_probs.ndim == 2:
                # Shape is [time_frames, 2] where columns are [non-speech_prob, speech_prob]
                if vad_probs.shape[1] == 2:
                    # Extract speech probabilities (second column)
                    speech_probs = vad_probs[:, 1]  # Get speech probabilities
                    speech_detected_frames = (speech_probs > self.speech_probability_threshold).tolist()
                    
                    if len(speech_detected_frames) > 0 and not self.quiet_mode:
                        # Debug: show some frame stats occasionally
                        avg_speech_prob = np.mean(speech_probs)
                        speech_frame_count = sum(speech_detected_frames)
                        if len(self.speech_frame_history) % 50 == 0:  # Log every 50 updates
                            print(f"[VAD-DEBUG] {len(speech_detected_frames)} frames, "
                                  f"avg_speech_prob: {avg_speech_prob:.3f}, "
                                  f"speech_frames: {speech_frame_count}")
                    return speech_detected_frames
                else:
                    if not self.quiet_mode:
                        print(f"Unexpected VAD output shape: {vad_probs.shape} - expected [frames, 2]")
                    return []
            elif vad_probs.ndim == 1:
                # Single dimension - treat as speech probabilities directly
                speech_detected_frames = (vad_probs > self.speech_probability_threshold).tolist()
                return speech_detected_frames
            else:
                if not self.quiet_mode:
                    print(f"Unexpected VAD output shape: {vad_probs.shape}")
                return []
            
        except Exception as e:
            if not self.quiet_mode:
                print(f"VAD analysis error: {e}")
            return []
    
    def update_speech_frame_history(self, speech_frames):
        """
        Update the rolling window of speech frame detections
        
        Args:
            speech_frames: List of boolean values for speech detection per frame
        """
        # Add each frame's speech detection result to the rolling window
        for is_speech in speech_frames:
            self.speech_frame_history.append(is_speech)
            
            # Track consecutive silence frames for immediate EOU detection
            if not is_speech:
                self.consecutive_silence_frames += 1
            else:
                self.consecutive_silence_frames = 0
    
    def get_recent_speech_proportion(self, window_seconds=None):
        """
        Calculate the proportion of frames with speech in the recent window
        
        Args:
            window_seconds: Analysis window in seconds (default: use class setting)
            
        Returns:
            dict: Analysis results including speech proportion and frame counts
        """
        if window_seconds is None:
            window_seconds = self.analysis_window_seconds
        
        window_frames = int(window_seconds / self.vad_frame_duration)
        
        if len(self.speech_frame_history) < self.min_frames_for_eou:
            return {
                "speech_proportion": 0.0,
                "speech_frames": 0,
                "total_frames": len(self.speech_frame_history),
                "window_seconds": window_seconds,
                "sufficient_data": False
            }
        
        # Get recent frames within the window
        recent_frames = list(self.speech_frame_history)[-window_frames:] if len(self.speech_frame_history) >= window_frames else list(self.speech_frame_history)
        
        speech_frames_count = sum(recent_frames)
        total_frames = len(recent_frames)
        speech_proportion = speech_frames_count / total_frames if total_frames > 0 else 0.0
        
        return {
            "speech_proportion": speech_proportion,
            "speech_frames": speech_frames_count,
            "total_frames": total_frames,
            "window_seconds": len(recent_frames) * self.vad_frame_duration,
            "sufficient_data": len(self.speech_frame_history) >= self.min_frames_for_eou
        }
    
    def detect_silence_period(self):
        """
        Detect if we're in a silence period based on speech proportion in recent window
        Uses both proportion-based analysis and consecutive silence detection
        
        Returns:
            bool: True if silence period detected (potential EOU)
        """
        if len(self.speech_frame_history) < self.min_frames_for_eou:
            return False
        
        # Method 1: Consecutive silence detection (more immediate)
        if self.consecutive_silence_frames >= self.consecutive_silence_threshold:
            if not self.quiet_mode:
                silence_duration = self.consecutive_silence_frames * self.vad_frame_duration
                print(f"[VAD-EOU] Consecutive silence detected: {silence_duration:.1f}s ({self.consecutive_silence_frames} frames)")
            return True
        
        # Method 2: Proportion-based analysis (smoother)
        analysis = self.get_recent_speech_proportion()
        
        if not analysis["sufficient_data"]:
            return False
        
        # Detect silence if speech proportion is below threshold
        is_silence_period = analysis["speech_proportion"] < self.speech_proportion_threshold
        
        if not self.quiet_mode and is_silence_period:
            print(f"[VAD-EOU] Low speech proportion detected: {analysis['speech_proportion']:.3f} "
                  f"({analysis['speech_frames']}/{analysis['total_frames']} frames over {analysis['window_seconds']:.1f}s)")
        
        return is_silence_period
    
    def get_recent_activity_summary(self, frames=None):
        """Get summary of recent speech activity"""
        if frames is None:
            # Use last 0.5 seconds for summary
            frames = int(0.5 / self.vad_frame_duration)
        
        analysis = self.get_recent_speech_proportion(window_seconds=frames * self.vad_frame_duration)
        
        return {
            "avg_activity": analysis["speech_proportion"],
            "speech_frames": analysis["speech_frames"],
            "total_frames": analysis["total_frames"],
            "avg_confidence": analysis["speech_proportion"]  # For compatibility
        }
    
    def has_recent_speech_activity(self, lookback_seconds=1.0):
        """
        Check if there has been significant speech activity in recent history
        
        Args:
            lookback_seconds: How far back to look for speech activity
            
        Returns:
            bool: True if there has been recent speech activity
        """
        lookback_analysis = self.get_recent_speech_proportion(window_seconds=lookback_seconds)
        
        if not lookback_analysis["sufficient_data"]:
            return False
        
        # Consider it "recent speech activity" if more than 15% of frames had speech (reduced from 20%)
        return lookback_analysis["speech_proportion"] > 0.15
    
    def reset_silence_tracking(self):
        """Reset consecutive silence tracking"""
        self.consecutive_silence_frames = 0
    
    # Keep legacy method for compatibility
    def analyze_model_outputs(self, pred_outputs, processed_signal_length=None):
        """Fallback method - kept for compatibility but VAD is preferred"""
        return {"speech_detected": True, "confidence": 0.5, "frame_activity": 0.5}

class OnlineASRWithPunctuation:
    def __init__(self, asr_model_name, punct_model_name=None, lookahead_size=480, decoder_type="rnnt", 
                 quiet_mode=False, enable_eou=True):
        """
        Initialize the Online ASR system with punctuation and frame-level EOU detection
        
        Args:
            asr_model_name: Name of the pretrained ASR model to use
            punct_model_name: Name of the punctuation model (None to disable)
            lookahead_size: Lookahead size in milliseconds
            decoder_type: "rnnt" or "ctc"
            quiet_mode: If True, suppress all logging
            enable_eou: If True, enable end-of-utterance detection
        """
        self.asr_model_name = asr_model_name
        self.punct_model_name = punct_model_name
        self.lookahead_size = lookahead_size
        self.decoder_type = decoder_type
        self.quiet_mode = quiet_mode
        self.enable_eou = enable_eou
        
        # Comprehensive logging suppression for quiet mode
        if quiet_mode:
            self._setup_quiet_mode()
            
        # Initialize models
        self._setup_asr_model()
        if punct_model_name:
            self._setup_punctuation_model()
        else:
            self.punct_model = None
            
        # Initialize EOU detection
        if enable_eou:
            self.eou_detector = EndOfUtteranceDetector(quiet_mode)
        else:
            self.eou_detector = None
            
        # Initialize frame-level speech detector
        self.frame_detector = FrameLevelSpeechDetector(quiet_mode)
        
        # Text buffer for punctuation processing and conversation tracking
        self.text_buffer = deque(maxlen=50)
        self.conversation_buffer = []  # Store full conversation for EOU analysis
        self.current_utterance = ""  # Accumulate text for complete utterance output
        self._setup_preprocessing()
        self._reset_streaming_state()
    
    def _setup_quiet_mode(self):
        """Setup comprehensive logging suppression for quiet mode"""
        # Suppress all NeMo logging
        nemo_logger = logging.getLogger('nemo_logger')
        nemo_logger.setLevel(logging.CRITICAL)
        
        # Suppress PyTorch Lightning logging
        pl_logger = logging.getLogger('pytorch_lightning')
        pl_logger.setLevel(logging.CRITICAL)
        
        # Suppress root logger
        logging.getLogger().setLevel(logging.CRITICAL)
        
        # Suppress all NeMo sub-loggers
        for name in logging.Logger.manager.loggerDict:
            if 'nemo' in name.lower():
                logging.getLogger(name).setLevel(logging.CRITICAL)
        
        # Suppress progress bars
        os.environ['NEMO_DISABLE_PROGRESS_BAR'] = '1'
        os.environ['TQDM_DISABLE'] = '1'
        
    def _setup_asr_model(self):
        """Load and configure the ASR model"""
        if not self.quiet_mode:
            print(f"Loading ASR model: {self.asr_model_name}")
        
        # Suppress output during model loading in quiet mode
        if self.quiet_mode:
            with open(os.devnull, 'w') as devnull:
                old_stderr = sys.stderr
                sys.stderr = devnull
                try:
                    self.asr_model = nemo_asr.models.ASRModel.from_pretrained(model_name=self.asr_model_name)
                finally:
                    sys.stderr = old_stderr
        else:
            self.asr_model = nemo_asr.models.ASRModel.from_pretrained(model_name=self.asr_model_name)
        
        # Update attention context size for multi-lookahead model
        if self.asr_model_name == "stt_en_fastconformer_hybrid_large_streaming_multi":
            if self.lookahead_size not in [0, 80, 480, 1040]:
                raise ValueError(
                    f"Lookahead size {self.lookahead_size} not valid for multi model. "
                    "Must be one of: 0, 80, 480, 1040 ms"
                )
            
            # Update attention context size
            left_context_size = self.asr_model.encoder.att_context_size[0]
            right_context_size = int(self.lookahead_size / ENCODER_STEP_LENGTH)
            self.asr_model.encoder.set_default_att_context_size([left_context_size, right_context_size])
            if not self.quiet_mode:
                print(f"Set attention context: [{left_context_size}, {right_context_size}]")
        
        # Configure decoder type
        self.asr_model.change_decoding_strategy(decoder_type=self.decoder_type)
        
        # Optimize decoding configuration
        decoding_cfg = self.asr_model.cfg.decoding
        with open_dict(decoding_cfg):
            decoding_cfg.strategy = "greedy"
            decoding_cfg.preserve_alignments = False
            if hasattr(self.asr_model, 'joint'):  # RNNT model
                decoding_cfg.greedy.max_symbols = 10
                decoding_cfg.fused_batch_size = -1
        
        self.asr_model.change_decoding_strategy(decoding_cfg)
        self.asr_model.eval()
        
        # Move to GPU if available
        if torch.cuda.is_available():
            self.asr_model = self.asr_model.cuda()
            if not self.quiet_mode:
                print(f"ASR model moved to GPU: {torch.cuda.get_device_name()}")
            
        if not self.quiet_mode:
            print(f"Using ASR decoder: {self.decoder_type}")
            print(f"Lookahead size: {self.lookahead_size}ms")
    
    def _setup_punctuation_model(self):
        """Load and configure the punctuation model"""
        if not self.quiet_mode:
            print(f"Loading punctuation model: {self.punct_model_name}")
        
        try:
            # Suppress output during model loading in quiet mode
            if self.quiet_mode:
                with open(os.devnull, 'w') as devnull:
                    old_stderr = sys.stderr
                    sys.stderr = devnull
                    try:
                        self.punct_model = nemo_nlp.models.PunctuationCapitalizationModel.from_pretrained(
                            model_name=self.punct_model_name
                        )
                    finally:
                        sys.stderr = old_stderr
            else:
                self.punct_model = nemo_nlp.models.PunctuationCapitalizationModel.from_pretrained(
                    model_name=self.punct_model_name
                )
                
            self.punct_model.eval()
            
            if torch.cuda.is_available():
                self.punct_model = self.punct_model.cuda()
                if not self.quiet_mode:
                    print("Punctuation model moved to GPU")
                
        except Exception as e:
            if not self.quiet_mode:
                print(f"Warning: Could not load punctuation model {self.punct_model_name}: {e}")
                print("Continuing without punctuation...")
            self.punct_model = None
    
    def _setup_preprocessing(self):
        """Initialize audio preprocessor"""
        cfg = copy.deepcopy(self.asr_model._cfg)
        OmegaConf.set_struct(cfg.preprocessor, False)
        
        # Streaming-specific preprocessing config
        cfg.preprocessor.dither = 0.0
        cfg.preprocessor.pad_to = 0
        cfg.preprocessor.normalize = "None"
        
        self.preprocessor = EncDecCTCModelBPE.from_config_dict(cfg.preprocessor)
        self.preprocessor.to(self.asr_model.device)
        
    def _reset_streaming_state(self, reset_conversation=True):
        """Reset streaming state for new session - complete ASR reset"""
        # Initialize cache states - complete reset
        self.cache_last_channel, self.cache_last_time, self.cache_last_channel_len = \
            self.asr_model.encoder.get_initial_cache_state(batch_size=1)
        
        # Initialize streaming variables - complete reset
        self.previous_hypotheses = None
        self.pred_out_stream = None
        self.step_num = 0
        
        # Pre-encode cache initialization - complete reset
        self.pre_encode_cache_size = self.asr_model.encoder.streaming_cfg.pre_encode_cache_size[1]
        num_channels = self.asr_model.cfg.preprocessor.features
        self.cache_pre_encode = torch.zeros(
            (1, num_channels, self.pre_encode_cache_size), 
            device=self.asr_model.device
        )
        
        # Reset text buffer - complete reset
        self.text_buffer.clear()
        
        # Reset conversation buffer if requested
        if reset_conversation:
            self.conversation_buffer = []
        
        # Reset current utterance accumulation
        self.current_utterance = ""
        
        if not self.quiet_mode:
            print("Complete ASR streaming state reset")
    
    def _extract_transcriptions(self, hyps):
        """Extract text from hypothesis objects"""
        if isinstance(hyps[0], Hypothesis):
            return [hyp.text for hyp in hyps]
        else:
            return hyps
            
    def _preprocess_audio(self, audio):
        """Convert audio to mel-spectrogram"""
        device = self.asr_model.device
        
        # Convert to tensor and move to device
        audio_signal = torch.from_numpy(audio).unsqueeze_(0).to(device)
        audio_signal_len = torch.Tensor([audio.shape[0]]).to(device)
        
        # Apply preprocessing
        processed_signal, processed_signal_length = self.preprocessor(
            input_signal=audio_signal, length=audio_signal_len
        )
        return processed_signal, processed_signal_length
    
    def _apply_punctuation(self, text):
        """Apply punctuation and capitalization to text"""
        if not self.punct_model or not text.strip():
            return text
            
        try:
            # Suppress output during punctuation in quiet mode
            if self.quiet_mode:
                with open(os.devnull, 'w') as devnull:
                    old_stderr = sys.stderr
                    old_stdout = sys.stdout
                    sys.stderr = devnull
                    sys.stdout = devnull
                    try:
                        punctuated_text = self.punct_model.add_punctuation_capitalization([text])[0]
                    finally:
                        sys.stderr = old_stderr
                        sys.stdout = old_stdout
            else:
                punctuated_text = self.punct_model.add_punctuation_capitalization([text])[0]
                
            return punctuated_text
                
        except Exception as e:
            if not self.quiet_mode:
                print(f"Punctuation error: {e}")
            return text
    
    def _check_end_of_utterance(self, text):
        """Check if the current text represents an end of utterance"""
        if not self.eou_detector or not text.strip():
            return False
        
        # Add current text to conversation buffer
        self.conversation_buffer.append(text)
        
        # Only check EOU periodically, not on every update
        if len(self.conversation_buffer) % 3 != 0:  # Check every 3rd update
            return False
        
        # Analyze the full conversation context for EOU
        full_conversation = " ".join(self.conversation_buffer)
        
        # Additional safeguards: don't check EOU too frequently
        if len(full_conversation.split()) < 5:  # Need at least 5 words
            return False
        
        # Check if this represents an end of utterance
        is_eou = self.eou_detector.detect_eou(full_conversation)
        
        if is_eou:
            if not self.quiet_mode:
                print(f"[EOU] End of utterance confirmed, resetting context")
            # Reset conversation buffer and streaming state
            self.conversation_buffer = []
            self._reset_streaming_state(reset_conversation=False)
            return True
        
        # Keep conversation buffer manageable but allow longer context for EOU
        if len(self.conversation_buffer) > 30:  # Increased from 20 to allow more context
            self.conversation_buffer = self.conversation_buffer[-25:]  # Keep more recent context
        
        return False
    
    def _check_end_of_utterance_frame_based(self, audio_chunk_raw):
        """
        Check for EOU using VAD analysis of raw audio with rolling window approach
        
        Args:
            audio_chunk_raw: Raw audio chunk (numpy array, float32)
            
        Returns:
            bool: True if EOU detected based on VAD analysis
        """
        if not self.enable_eou or self.frame_detector.vad_model is None:
            return False
        
        # Analyze current audio chunk with VAD to get frame-level speech detection
        speech_frames = self.frame_detector.analyze_audio_vad(audio_chunk_raw)
        
        if not speech_frames:  # No frames analyzed
            return False
        
        # Update the rolling window with new frame results
        self.frame_detector.update_speech_frame_history(speech_frames)
        
        # Check if current period represents silence (low speech proportion or consecutive silence)
        is_silence = self.frame_detector.detect_silence_period()
        
        if is_silence:
            # Additional validation: ensure we've had some speech before declaring EOU
            has_had_recent_speech = self.frame_detector.has_recent_speech_activity(lookback_seconds=1.5)  # Reduced from 2.0s
            
            if has_had_recent_speech:
                # Get summary for logging
                summary = self.frame_detector.get_recent_activity_summary()
                
                if not self.quiet_mode:
                    print(f"[VAD-EOU] End of utterance detected based on speech analysis")
                    print(f"  Recent speech proportion: {summary['avg_activity']:.3f}")
                    print(f"  Speech frames: {summary['speech_frames']}/{summary['total_frames']}")
                    print(f"  Consecutive silence frames: {self.frame_detector.consecutive_silence_frames}")
                
                # Reset frame history and silence tracking for fresh start
                self.frame_detector.speech_frame_history.clear()
                self.frame_detector.reset_silence_tracking()
                return True
            else:
                if not self.quiet_mode:
                    print(f"[VAD-DEBUG] Silence detected but no recent speech activity - not triggering EOU")
        
        return False
    
    def transcribe_chunk(self, audio_chunk):
        """
        Transcribe a single audio chunk with punctuation and VAD-based EOU detection
        
        Args:
            audio_chunk: numpy array of audio samples (int16)
            
        Returns:
            tuple: (raw_text, punctuated_text, is_eou, complete_utterance)
        """
        # Convert int16 to float32 and normalize
        audio_data = audio_chunk.astype(np.float32) / 32768.0
        
        # VAD-based EOU detection using raw audio (before preprocessing)
        is_frame_eou = self._check_end_of_utterance_frame_based(audio_data)
        
        # Get mel-spectrogram
        processed_signal, processed_signal_length = self._preprocess_audio(audio_data)
        
        # Prepend with pre-encode cache
        processed_signal = torch.cat([self.cache_pre_encode, processed_signal], dim=-1)
        processed_signal_length += self.cache_pre_encode.shape[1]
        
        # Update cache for next iteration
        self.cache_pre_encode = processed_signal[:, :, -self.pre_encode_cache_size:]
        
        # Run streaming inference
        with torch.no_grad():
            (
                self.pred_out_stream,
                transcribed_texts,
                self.cache_last_channel,
                self.cache_last_time,
                self.cache_last_channel_len,
                self.previous_hypotheses,
            ) = self.asr_model.conformer_stream_step(
                processed_signal=processed_signal,
                processed_signal_length=processed_signal_length,
                cache_last_channel=self.cache_last_channel,
                cache_last_time=self.cache_last_time,
                cache_last_channel_len=self.cache_last_channel_len,
                keep_all_outputs=False,
                previous_hypotheses=self.previous_hypotheses,
                previous_pred_out=self.pred_out_stream,
                drop_extra_pre_encoded=None,
                return_transcription=True,
            )
        
        # Extract transcription
        final_transcriptions = self._extract_transcriptions(transcribed_texts)
        raw_text = final_transcriptions[0] if final_transcriptions else ""
        
        # Text-based EOU detection (existing logic)
        is_text_eou = False
        if self.eou_detector and raw_text.strip():
            # Add current text to conversation buffer
            self.conversation_buffer.append(raw_text)
            
            # Only check text-based EOU periodically
            if len(self.conversation_buffer) % 3 != 0:  # Check every 3rd update for text-based
                pass
            else:
                # Analyze the full conversation context for EOU
                full_conversation = " ".join(self.conversation_buffer)
                
                # Additional safeguards for text-based EOU
                if len(full_conversation.split()) >= 5:  # Need at least 5 words
                    is_text_eou = self.eou_detector.detect_eou(full_conversation)
        
        # Combined EOU detection: Either VAD-based OR text-based can trigger
        # VAD-based is more immediate, text-based provides semantic confirmation
        is_eou = is_frame_eou or is_text_eou
        
        # Apply punctuation if enabled
        if self.punct_model and raw_text.strip():
            punctuated_text = self._apply_punctuation(raw_text)
        else:
            punctuated_text = raw_text
        
        # Accumulate current utterance for complete output
        if punctuated_text.strip():
            self.current_utterance = punctuated_text
        
        # Handle EOU detection and complete utterance output
        complete_utterance = None
        if is_eou:
            # Store the final complete utterance for output
            complete_utterance = self.current_utterance.strip() if self.current_utterance.strip() else punctuated_text.strip()
            
            if not self.quiet_mode:
                eou_type = "VAD" if is_frame_eou else "Text"
                if is_frame_eou and is_text_eou:
                    eou_type = "VAD+Text"
                print(f"[{eou_type}-EOU] End of utterance confirmed, performing complete ASR reset")
            
            # COMPLETE ASR RESET - Reset conversation buffer and streaming state entirely
            self.conversation_buffer = []
            self._reset_streaming_state(reset_conversation=False)
            
            # Return the complete utterance for final output
            return raw_text, punctuated_text, True, complete_utterance
        else:
            # Keep conversation buffer manageable
            if len(self.conversation_buffer) > 30:
                self.conversation_buffer = self.conversation_buffer[-25:]
        
        self.step_num += 1
        
        return raw_text, punctuated_text, is_eou, complete_utterance

def list_audio_devices():
    """List available audio input devices"""
    p = pa.PyAudio()
    print('Available audio input devices:')
    input_devices = []
    
    for i in range(p.get_device_count()):
        dev = p.get_device_info_by_index(i)
        if dev.get('maxInputChannels'):
            input_devices.append(i)
            print(f"  {i}: {dev.get('name')} (channels: {dev.get('maxInputChannels')})")
    
    p.terminate()
    return input_devices

# HTTP/WebSocket client libraries
import aiohttp
import websockets

# Import the lambda client
from lambda_llm_client import LambdaLLMClient, LambdaWebSocketClient

class BedrockLLMClient:
    """Client for communicating with AWS Bedrock directly"""
    
    def __init__(self, model_id: str = None, region: str = "us-east-1"):
        if not AWS_AVAILABLE:
            raise ImportError("boto3 is required for Bedrock integration. Install with: pip install boto3")
        
        self.model_id = model_id or os.getenv('BEDROCK_MODEL_ID', 'anthropic.claude-3-sonnet-20240229-v1:0')
        self.region = region
        self.session_id = None
        self.conversation_history = []
        
        # Initialize Bedrock client
        try:
            self.bedrock_client = boto3.client('bedrock-runtime', region_name=region)
            print(f"Bedrock client initialized for region: {region}")
        except NoCredentialsError:
            print("Error: AWS credentials not found. Please configure AWS credentials.")
            raise
        except Exception as e:
            print(f"Error initializing Bedrock client: {e}")
            raise
    
    def send_message_sync(self, message: str, deep_search: bool = False) -> str:
        """Send message to Bedrock and return the response"""
        if not self.session_id:
            self.session_id = f"asr_session_{int(time.time())}"
        
        # Add user message to conversation history
        self.conversation_history.append({
            "role": "user",
            "content": message
        })
        
        try:
            # Prepare the request for Claude
            system_prompt = """You are a helpful assistant. Respond naturally to the user's speech input. 
Keep your responses conversational and concise unless more detail is specifically requested."""
            
            # Format messages for Claude API
            formatted_messages = []
            for msg in self.conversation_history:
                formatted_messages.append({
                    "role": msg["role"],
                    "content": msg["content"]
                })
            
            # Prepare inference parameters
            inference_config = {
                "temperature": 0.7,
                "topP": 0.9,
                "maxTokens": 1000
            }
            
            # Make request to Bedrock
            response = self.bedrock_client.converse(
                modelId=self.model_id,
                messages=formatted_messages,
                system=[{"text": system_prompt}],
                inferenceConfig=inference_config
            )
            
            # Extract response text
            assistant_message = ""
            if 'output' in response and 'message' in response['output']:
                content = response['output']['message']['content']
                if isinstance(content, list) and len(content) > 0:
                    assistant_message = content[0].get('text', '')
                elif isinstance(content, str):
                    assistant_message = content
            
            # Add assistant response to conversation history
            if assistant_message:
                self.conversation_history.append({
                    "role": "assistant",
                    "content": assistant_message
                })
            
            return assistant_message or "I didn't generate a response."
            
        except ClientError as e:
            error_code = e.response['Error']['Code']
            error_message = e.response['Error']['Message']
            print(f"Bedrock API error [{error_code}]: {error_message}")
            return f"Sorry, I encountered an error: {error_message}"
        except Exception as e:
            print(f"Unexpected Bedrock error: {e}")
            return f"Sorry, I encountered an unexpected error: {e}"
    
    def clear_history(self):
        """Clear conversation history"""
        self.conversation_history = []
        self.session_id = None

class WebSocketLLMClient:
    """Client for communicating with WebSocket LLM service (like the JavaScript version)"""
    
    def __init__(self, api_endpoint: str, model_id: str = None, region: str = "us-east-1"):
        self.api_endpoint = api_endpoint
        self.model_id = model_id or os.getenv('BEDROCK_MODEL_ID', 'anthropic.claude-3-sonnet-20240229-v1:0')
        self.region = region
        self.session_id = None
        self.conversation_history = []
        
    async def send_message_websocket(self, message: str, deep_search: bool = False, quiet_mode: bool = False) -> str:
        """Send message via WebSocket and return the complete response"""
        if not self.session_id:
            self.session_id = f"asr_session_{int(time.time())}"
        
        # Add user message to conversation history
        self.conversation_history.append({
            "role": "user",
            "content": message
        })
        
        try:
            # Convert HTTP/HTTPS to WebSocket URLs
            uri = self.api_endpoint
            if uri.startswith('https://'):
                uri = uri.replace('https://', 'wss://')
            elif uri.startswith('http://'):
                uri = uri.replace('http://', 'ws://')
            
            if not quiet_mode:
                print(f"Connecting to WebSocket: {uri}")
            
            async with websockets.connect(
                uri
            ) as websocket:
                request_data = {
                    "action": "completion",
                    "history": [{"role": "user", "content": message}],
                    "sessionId": self.session_id
                }
                
                if not quiet_mode:
                    print(f"Sending WebSocket request:")
                    print(json.dumps(request_data, indent=2))
                
                await websocket.send(json.dumps(request_data))
                
                # Store chunks by chunk number for proper ordering
                chunks = {}
                max_chunk_number = 0
                is_finished = False
                timeout_count = 0
                max_timeout = 30  # 30 second timeout
                
                # Initialize progressive display for quiet mode
                if quiet_mode:
                    print(f"[LLM] ", end='', flush=True)
                
                # Receive response chunks with timeout
                try:
                    while timeout_count < max_timeout and not is_finished:
                        try:
                            message_data = await asyncio.wait_for(websocket.recv(), timeout=1.0)
                            timeout_count = 0  # Reset timeout on successful receive
                            
                            data = json.loads(message_data)
                            if not quiet_mode:
                                print(f"Received WebSocket message: {data}")
                            
                            if data.get("action") == "completion":
                                if "content" in data and "chunkNumber" in data:
                                    chunk_number = data["chunkNumber"]
                                    content_chunk = data["content"]
                                    chunks[chunk_number] = content_chunk
                                    max_chunk_number = max(max_chunk_number, chunk_number)
                                    
                                    # Build response progressively in order
                                    ordered_response = ""
                                    for i in range(1, max_chunk_number + 1):
                                        if i in chunks:
                                            ordered_response += chunks[i]
                                    
                                    # Update display in quiet mode - rewrite the entire line
                                    if quiet_mode:
                                        # Clear the line and rewrite with updated content
                                        print(f"\r[LLM] {ordered_response}", end='', flush=True)
                                    elif not quiet_mode:
                                        print(f"Content chunk {chunk_number}: {content_chunk}")
                                
                                if data.get("isFinished", False):
                                    is_finished = True
                                    final_chunk_number = data.get("chunkNumber", max_chunk_number)
                                    if not quiet_mode:
                                        print(f"Response finished at chunk {final_chunk_number}")
                                    
                            elif "error" in data:
                                error_msg = f"Server error: {data['error']}"
                                if quiet_mode:
                                    print(f"\r[LLM] {error_msg}", end='', flush=True)
                                else:
                                    print(f"WebSocket error from server: {data['error']}")
                                return error_msg
                                    
                        except asyncio.TimeoutError:
                            timeout_count += 1
                            continue
                        except json.JSONDecodeError as e:
                            if not quiet_mode:
                                print(f"JSON decode error: {e}")
                            continue
                            
                except Exception as recv_error:
                    if not quiet_mode:
                        print(f"Error receiving WebSocket message: {recv_error}")
                
                # Build final ordered response
                complete_response = ""
                for i in range(1, max_chunk_number + 1):
                    if i in chunks:
                        complete_response += chunks[i]
                
                # Add assistant response to conversation history
                if complete_response.strip():
                    self.conversation_history.append({
                        "role": "assistant", 
                        "content": complete_response
                    })
                
                return complete_response or "No response received from WebSocket"
                
        except websockets.exceptions.InvalidStatusCode as e:
            error_msg = f"WebSocket connection failed with status {e.status_code}"
            if e.status_code == 403:
                error_msg += "\n\nPossible solutions for 403 error:"
                error_msg += "\n1. Check if your API Gateway allows WebSocket connections"
                error_msg += "\n2. Verify CORS settings in API Gateway"
                error_msg += "\n3. Ensure your AWS credentials have proper permissions"
                error_msg += "\n4. Check if the WebSocket route requires authentication"
                error_msg += "\n5. Try using --use-bedrock instead for direct AWS access"
            if not quiet_mode:
                print(error_msg)
            return error_msg
        except Exception as e:
            error_msg = f"WebSocket error: {e}"
            if not quiet_mode:
                print(error_msg)
            return error_msg
    
    def send_message_sync(self, message: str, deep_search: bool = False, quiet_mode: bool = False) -> str:
        """Synchronous wrapper for sending messages"""
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        try:
            return loop.run_until_complete(self.send_message_websocket(message, deep_search, quiet_mode))
        finally:
            loop.close()
    
    def clear_history(self):
        """Clear conversation history"""
        self.conversation_history = []
        self.session_id = None

class SimpleLLMClient:
    """Simple HTTP-based LLM client for testing"""
    
    def __init__(self, api_endpoint: str, model_id: str = None):
        self.api_endpoint = api_endpoint
        self.model_id = model_id
        self.conversation_history = []
    
    def send_message_sync(self, message: str, deep_search: bool = False) -> str:
        """Send message via HTTP and return response"""
        self.conversation_history.append({"role": "user", "content": message})
        
        # For testing, just echo back the message
        response = f"Echo: {message}"
        self.conversation_history.append({"role": "assistant", "content": response})
        return response
    
    def clear_history(self):
        """Clear conversation history"""
        self.conversation_history = []

class ASRLLMIntegration:
    """Main class that integrates ASR with LLM communication"""
    
    def __init__(self, 
                 asr_model_name: str,
                 llm_client,
                 punct_model_name: str = None,
                 lookahead_size: int = 480,
                 decoder_type: str = "rnnt",
                 quiet_mode: bool = True,
                 enable_eou: bool = True,
                 retry_on_error: bool = True):
        
        self.llm_client = llm_client
        self.quiet_mode = quiet_mode
        self.retry_on_error = retry_on_error
        self.utterance_queue = queue.Queue()
        self.llm_thread = None
        self.running = False
        
        # Initialize ASR system using the complete OnlineASRWithPunctuation class
        if not quiet_mode:
            print("Initializing ASR system...")
        self.asr_system = OnlineASRWithPunctuation(
            asr_model_name=asr_model_name,
            punct_model_name=punct_model_name,
            lookahead_size=lookahead_size,
            decoder_type=decoder_type,
            quiet_mode=quiet_mode,
            enable_eou=enable_eou
        )
        
        if not quiet_mode:
            print("ASR-LLM Integration ready!")
    
    def _llm_worker(self):
        """Worker thread that processes utterances and sends them to LLM"""
        while self.running:
            try:
                # Get utterance from queue (with timeout to allow checking self.running)
                utterance = self.utterance_queue.get(timeout=1.0)
                
                if utterance is None:  # Shutdown signal
                    break
                
                if self.quiet_mode:
                    # In quiet mode, just show the transition on a new line
                    print(f"")  # Move to new line after user input
                else:
                    print(f"\n{'='*60}")
                    print(f"[USER] {utterance}")
                    print(f"{'='*60}")
                    print("[LLM] Processing...")
                
                # Send to LLM with retry logic
                response = None
                retry_count = 0
                max_retries = 2 if self.retry_on_error else 0
                
                while retry_count <= max_retries and response is None:
                    try:
                        # Pass quiet_mode to the LLM client if it supports it
                        if hasattr(self.llm_client, 'send_message_sync') and 'quiet_mode' in self.llm_client.send_message_sync.__code__.co_varnames:
                            response = self.llm_client.send_message_sync(utterance, deep_search=False, quiet_mode=self.quiet_mode)
                        else:
                            response = self.llm_client.send_message_sync(utterance, deep_search=False)
                        
                        # Check if we got an error response
                        if "WebSocket connection failed" in response or "server rejected" in response:
                            if retry_count < max_retries:
                                error_msg = f"WebSocket error, retrying... (attempt {retry_count + 1}/{max_retries + 1})"
                                if self.quiet_mode:
                                    print(f"\r[LLM] {error_msg}", end='', flush=True)
                                else:
                                    print(f"[LLM] {error_msg}")
                                time.sleep(2)  # Wait before retry
                                response = None
                                retry_count += 1
                                continue
                            else:
                                error_msg = "Sorry, I'm having trouble connecting to the LLM service. Please check the WebSocket endpoint configuration."
                                if self.quiet_mode:
                                    print(f"\r[LLM] {error_msg}", end='', flush=True)
                                else:
                                    print(f"[LLM] WebSocket failed after {max_retries + 1} attempts")
                                response = error_msg
                        
                    except Exception as e:
                        if retry_count < max_retries:
                            error_msg = f"Error occurred, retrying... (attempt {retry_count + 1}/{max_retries + 1}): {e}"
                            if self.quiet_mode:
                                print(f"\r[LLM] {error_msg}", end='', flush=True)
                            else:
                                print(f"[LLM] {error_msg}")
                            time.sleep(2)
                            retry_count += 1
                            continue
                        else:
                            error_msg = f"Sorry, I encountered an error: {e}"
                            if self.quiet_mode:
                                print(f"\r[LLM] {error_msg}", end='', flush=True)
                            else:
                                print(f"[LLM] Failed after {max_retries + 1} attempts: {e}")
                            response = error_msg
                            break
                
                # Clean up response (remove thinking tags, etc.)
                cleaned_response = self._clean_llm_response(response)
                
                if self.quiet_mode:
                    # In quiet mode, ensure we show the final response if not already shown progressively
                    if not hasattr(self.llm_client, 'send_message_sync') or 'quiet_mode' not in self.llm_client.send_message_sync.__code__.co_varnames:
                        print(f"\r[LLM] {cleaned_response}", end='', flush=True)
                    # Move to new line and prepare for next user input
                    print(f"\n[USER] ", end='', flush=True)
                else:
                    print(f"\n[LLM] {cleaned_response}")
                    print(f"{'='*60}")
                    print("Listening for next utterance...")
                
                self.utterance_queue.task_done()
                
            except queue.Empty:
                continue
            except Exception as e:
                if not self.quiet_mode:
                    print(f"LLM worker error: {e}")
                continue
    
    def _clean_llm_response(self, response: str) -> str:
        """Clean up LLM response by removing thinking tags and formatting"""
        # Remove <Thinking>...</Thinking> blocks
        response = re.sub(r'<Thinking>.*?</Thinking>', '', response, flags=re.DOTALL)
        
        # Extract content from <Response>...</Response> tags
        response_match = re.search(r'<Response>(.*?)</Response>', response, flags=re.DOTALL)
        if response_match:
            response = response_match.group(1)
        
        # Remove tool use tags
        response = re.sub(r'<ToolUse[^>]*>', '', response)
        response = re.sub(r'</ToolUse>', '', response)
        
        # Clean up whitespace
        response = response.strip()
        
        return response
    
    def start_llm_worker(self):
        """Start the LLM worker thread"""
        self.running = True
        self.llm_thread = threading.Thread(target=self._llm_worker, daemon=True)
        self.llm_thread.start()
    
    def stop_llm_worker(self):
        """Stop the LLM worker thread"""
        self.running = False
        self.utterance_queue.put(None)  # Shutdown signal
        if self.llm_thread:
            self.llm_thread.join()
    
    def process_utterance(self, utterance: str):
        """Add utterance to queue for LLM processing"""
        if utterance.strip():
            self.utterance_queue.put(utterance.strip())
    
    def run_streaming_asr(self, device_id: Optional[int] = None, chunk_size_ms: Optional[int] = None):
        """Run streaming ASR with LLM integration using the exact same functionality as the VAD EOU file"""
        
        # Start LLM worker thread
        self.start_llm_worker()
        
        # Calculate chunk size
        if chunk_size_ms is None:
            chunk_size_ms = self.asr_system.lookahead_size + ENCODER_STEP_LENGTH
        
        if not self.quiet_mode:
            print(f"Using chunk size: {chunk_size_ms}ms")
        
        # Initialize PyAudio
        p = pa.PyAudio()
        
        try:
            # Select audio device using the same logic as the VAD EOU file
            input_devices = []
            for i in range(p.get_device_count()):
                dev = p.get_device_info_by_index(i)
                if dev.get('maxInputChannels'):
                    input_devices.append(i)
            
            if not input_devices:
                if not self.quiet_mode:
                    print('ERROR: No audio input device found.')
                return
            
            if device_id is None:
                if not self.quiet_mode:
                    print('Available audio input devices:')
                    for i in input_devices:
                        dev = p.get_device_info_by_index(i)
                        print(f"  {i}: {dev.get('name')} (channels: {dev.get('maxInputChannels')})")
                    
                    device_id = -1
                    while device_id not in input_devices:
                        try:
                            device_id = int(input('Please enter input device ID: '))
                        except ValueError:
                            print("Please enter a valid device ID number")
                            continue
                else:
                    # In quiet mode, use the first available device
                    device_id = input_devices[0]
            
            if device_id not in input_devices:
                if not self.quiet_mode:
                    print(f"Error: Device {device_id} not found in available input devices")
                return
            
            if not self.quiet_mode:
                print(f"Using device {device_id}: {p.get_device_info_by_index(device_id)['name']}")
            
            # Calculate frames per buffer
            frames_per_buffer = int(SAMPLE_RATE * chunk_size_ms / 1000) - 1
            
            # Store last transcription to avoid repetition
            last_utterance = ""
            last_raw = ""
            last_punct = ""
            
            # Initialize quiet mode display
            if self.quiet_mode:
                print("[USER] ", end='', flush=True)
            
            # Define callback function - exact same functionality as VAD EOU file
            def stream_callback(in_data, frame_count, time_info, status):
                nonlocal last_utterance, last_raw, last_punct
                
                if status and not self.quiet_mode:
                    print(f"Stream status: {status}")
                
                # Convert audio data and transcribe using the exact same method
                signal = np.frombuffer(in_data, dtype=np.int16)
                raw_text, punct_text, is_eou, complete_utterance = self.asr_system.transcribe_chunk(signal)
                
                # Handle complete utterance - send to LLM
                if is_eou and complete_utterance and complete_utterance != last_utterance:
                    if self.quiet_mode:
                        # In quiet mode, show the final user utterance with complete line rewrite
                        print(f"\r[USER] {complete_utterance}", end='', flush=True)
                    else:
                        print(f"\n{'='*60}")
                        print(f"COMPLETE UTTERANCE DETECTED:")
                        print(f"{'='*60}")
                        print(f"{complete_utterance}")
                        print(f"{'='*60}")
                    
                    # Send to LLM
                    self.process_utterance(complete_utterance)
                    last_utterance = complete_utterance
                    
                    # Reset tracking variables for fresh start
                    last_raw = ""
                    last_punct = ""
                    return (in_data, pa.paContinue)
                
                # Show incremental updates if text has changed and it's not an EOU
                if raw_text.strip() and raw_text != last_raw and not is_eou:
                    if self.quiet_mode:
                        # In quiet mode, progressively update the user text on the same line
                        if punct_text.strip():
                            # Clear line and rewrite with updated punctuated text
                            print(f"\r[USER] {punct_text}", end='', flush=True)
                    else:
                        print(f"\r[Listening] {punct_text}", end='', flush=True)
                    
                    last_raw = raw_text
                    last_punct = punct_text
                
                return (in_data, pa.paContinue)
            
            # Open audio stream with same parameters as VAD EOU file
            stream = p.open(
                format=pa.paInt16,
                channels=1,
                rate=SAMPLE_RATE,
                input=True,
                input_device_index=device_id,
                stream_callback=stream_callback,
                frames_per_buffer=frames_per_buffer
            )
            
            if not self.quiet_mode:
                print('\nListening for speech... (Press Ctrl+C to stop)')
                print('When you finish speaking, the utterance will be sent to the LLM.')
                if self.asr_system.punct_model:
                    print('Punctuation and capitalization enabled')
                else:
                    print('No punctuation model loaded')
                if self.asr_system.eou_detector:
                    print('End-of-utterance detection enabled')
                else:
                    print('EOU detection disabled')
                print('=' * 60)
            
            # Start streaming
            stream.start_stream()
            
            try:
                while stream.is_active():
                    time.sleep(0.1)
            except KeyboardInterrupt:
                if self.quiet_mode:
                    print("\nExiting...")
                else:
                    print('\n\nStopping...')
            finally:
                stream.stop_stream()
                stream.close()
                if not self.quiet_mode:
                    print("Audio stream stopped")
        
        finally:
            p.terminate()
            self.stop_llm_worker()

def main():
    parser = argparse.ArgumentParser(
        description="ASR to LLM Integration - Real-time speech recognition with LLM communication",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Using AWS Bedrock directly (recommended)
  python asr_llm_integration.py --use-bedrock --model-id anthropic.claude-3-sonnet-20240229-v1:0

  # Using Lambda functionality directly (includes Knowledge Base)
  python asr_llm_integration.py --use-lambda --model-id anthropic.claude-3-sonnet-20240229-v1:0

  # Using WebSocket endpoint
  python asr_llm_integration.py --llm-endpoint wss://your-api-gateway.execute-api.region.amazonaws.com/prod

  # Testing mode (echo responses)
  python asr_llm_integration.py --test-mode
        """
    )
    
    # LLM Configuration
    llm_group = parser.add_mutually_exclusive_group(required=True)
    llm_group.add_argument(
        "--llm-endpoint",
        help="LLM API endpoint (WebSocket WS/WSS URL)"
    )
    llm_group.add_argument(
        "--use-bedrock",
        action="store_true",
        help="Use AWS Bedrock directly (requires AWS credentials)"
    )
    llm_group.add_argument(
        "--use-lambda",
        action="store_true",
        help="Use Lambda functionality directly (includes Knowledge Base access)"
    )
    llm_group.add_argument(
        "--test-mode",
        action="store_true",
        help="Use test mode (echo responses)"
    )
    
    parser.add_argument(
        "--model-id",
        default=None,
        help="LLM model ID (defaults to environment variable BEDROCK_MODEL_ID)"
    )
    
    parser.add_argument(
        "--aws-region",
        default="us-east-1",
        help="AWS region for Bedrock (default: us-east-1)"
    )
    
    parser.add_argument(
        "--deep-search",
        action="store_true",
        help="Enable deep search mode for LLM"
    )
    
    parser.add_argument(
        "--no-retry",
        action="store_true",
        help="Disable retry on LLM communication errors"
    )
    
    # ASR Configuration
    parser.add_argument(
        "--asr-model",
        default="stt_en_fastconformer_hybrid_large_streaming_multi",
        choices=AVAILABLE_ASR_MODELS,
        help="ASR model name to use"
    )
    
    parser.add_argument(
        "--punct-model",
        default="punctuation_en_bert",
        choices=AVAILABLE_PUNCT_MODELS + [None],
        help="Punctuation model name (None to disable punctuation)"
    )
    
    parser.add_argument(
        "--lookahead",
        type=int,
        default=480,
        help="Lookahead size in milliseconds (0, 80, 480, 1040 for multi model)"
    )
    
    parser.add_argument(
        "--decoder",
        default="rnnt",
        choices=["rnnt", "ctc"],
        help="ASR decoder type to use"
    )
    
    # Audio Configuration  
    parser.add_argument(
        "--device",
        type=int,
        help="Audio device ID (will prompt if not provided)"
    )
    
    parser.add_argument(
        "--chunk-size",
        type=int,
        help="Chunk size in milliseconds (auto-calculated if not provided)"
    )
    
    # EOU Configuration
    parser.add_argument(
        "--no-eou",
        action="store_true",
        help="Disable end-of-utterance detection"
    )
    
    parser.add_argument(
        "--vad-speech-threshold",
        type=float,
        default=0.5,
        help="VAD probability threshold for speech detection (0.0-1.0)"
    )
    
    parser.add_argument(
        "--vad-speech-proportion-threshold",
        type=float,
        default=0.2,
        help="Speech proportion threshold for EOU detection (0.0-1.0, lower = more sensitive)"
    )
    
    parser.add_argument(
        "--vad-analysis-window",
        type=float,
        default=2.0,
        help="Analysis window in seconds for speech proportion calculation"
    )
    
    # Utility
    parser.add_argument(
        "--verbose",
        action="store_true",
        help="Enable verbose output (show incremental transcriptions)"
    )
    
    parser.add_argument(
        "--quiet",
        action="store_true",
        help="Quiet mode: only show progressive [USER] and [LLM] text updates"
    )
    
    parser.add_argument(
        "--list-devices",
        action="store_true",
        help="List available audio devices and exit"
    )
    
    args = parser.parse_args()
    
    # Handle conflicting arguments
    if args.verbose and args.quiet:
        print("Error: --verbose and --quiet cannot be used together")
        return
    
    # List devices and exit if requested
    if args.list_devices:
        p = pa.PyAudio()
        print('Available audio input devices:')
        for i in range(p.get_device_count()):
            dev = p.get_device_info_by_index(i)
            if dev.get('maxInputChannels'):
                print(f"  {i}: {dev.get('name')} (channels: {dev.get('maxInputChannels')})")
        p.terminate()
        return
    
    try:
        # Initialize LLM client based on selected mode
        if not args.quiet:
            print("Initializing LLM client...")
        
        if args.use_bedrock:
            if not AWS_AVAILABLE:
                print("Error: boto3 not installed. Install with: pip install boto3")
                return
            llm_client = BedrockLLMClient(
                model_id=args.model_id,
                region=args.aws_region
            )
            if not args.quiet:
                print("Using AWS Bedrock for LLM communication")
        elif args.use_lambda:
            if not AWS_AVAILABLE:
                print("Error: boto3 not installed. Install with: pip install boto3")
                return
            llm_client = LambdaWebSocketClient(
                region=args.aws_region,
                model_id=args.model_id
            )
            if not args.quiet:
                print("Using Lambda functionality (includes Knowledge Base access)")
                print("Note: Requires KB_ID environment variable for Knowledge Base access")
        elif args.test_mode:
            llm_client = SimpleLLMClient("http://test")
            if not args.quiet:
                print("Using test mode (echo responses)")
        else:
            llm_client = WebSocketLLMClient(
                api_endpoint=args.llm_endpoint,
                model_id=args.model_id,
                region=args.aws_region
            )
            if not args.quiet:
                print(f"Using WebSocket endpoint: {args.llm_endpoint}")
                print("Note: WebSocket requests will be sent in the format:")
                print('{"action": "completion", "history": [{"role": "user", "content": "message"}]}')
        
        # Initialize ASR-LLM integration
        # Set quiet_mode based on args: quiet mode if --quiet is set, verbose if --verbose is set
        quiet_mode = args.quiet or not args.verbose
        
        integration = ASRLLMIntegration(
            asr_model_name=args.asr_model,
            llm_client=llm_client,
            punct_model_name=args.punct_model,
            lookahead_size=args.lookahead,
            decoder_type=args.decoder,
            quiet_mode=quiet_mode,
            enable_eou=not args.no_eou,
            retry_on_error=not args.no_retry
        )
        
        # Configure VAD parameters
        if integration.asr_system.frame_detector:
            integration.asr_system.frame_detector.speech_probability_threshold = args.vad_speech_threshold
            integration.asr_system.frame_detector.speech_proportion_threshold = args.vad_speech_proportion_threshold
            integration.asr_system.frame_detector.analysis_window_seconds = args.vad_analysis_window
        
        if not args.quiet:
            print("\nASR-LLM Integration ready!")
            print(f"ASR Model: {args.asr_model}")
            print(f"Punctuation Model: {args.punct_model or 'None'}")
            print(f"EOU Detection: {'Enabled' if not args.no_eou else 'Disabled'}")
            print(f"Retry on Error: {'Enabled' if not args.no_retry else 'Disabled'}")
            
            if args.use_lambda:
                print("\nLambda functionality includes:")
                print("- Direct Bedrock access with streaming")
                print("- Knowledge Base search integration")
                print("- Tool calling support")
                print("- RMIT University research assistant prompts")
            
            if args.llm_endpoint:
                print("\n" + "="*60)
                print("WEBSOCKET REQUEST FORMAT:")
                print("="*60)
                print("Each request will be sent as:")
                print(json.dumps({
                    "action": "completion",
                    "history": [
                        {"role": "user", "content": "your speech input"}
                    ]
                }, indent=2))
                print("="*60 + "\n")
                
                print("WEBSOCKET TROUBLESHOOTING TIPS:")
                print("="*60)
                print("If you get 403 errors:")
                print("1. Check API Gateway WebSocket route configuration")
                print("2. Verify CORS settings allow WebSocket connections")
                print("3. Ensure proper authentication is set up")
                print("4. Try using --use-bedrock instead for direct access")
                print("="*60 + "\n")
        
        # Run the integration
        integration.run_streaming_asr(
            device_id=args.device,
            chunk_size_ms=args.chunk_size
        )
        
    except KeyboardInterrupt:
        print("\nExiting...")
    except Exception as e:
        print(f"Error: {e}")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    main()
