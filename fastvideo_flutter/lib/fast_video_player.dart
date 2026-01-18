import 'dart:async';
import 'package:flutter/foundation.dart';
import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';

enum FastVideoEventType {
  initialized,
  started,
  paused,
  ended,
  progress,
  unknown
}

class FastVideoEvent {
  final FastVideoEventType type;
  final Duration? duration;
  final Duration? position;

  FastVideoEvent({required this.type, this.duration, this.position});
  
  @override
  String toString() => 'FastVideoEvent(type: $type, pos: $position, dur: $duration)';
}

class FastVideoPlayerController {
  MethodChannel? _channel;
  final StreamController<FastVideoEvent> _eventStreamController = StreamController.broadcast();
  
  // Stats & Debug info
  final ValueNotifier<String> statsNotifier = ValueNotifier("Initializing...");
  final ValueNotifier<String> decoderNotifier = ValueNotifier("");
  
  // Cached State for synchronous access
  Duration _valueDuration = Duration.zero;
  Duration _valuePosition = Duration.zero;
  bool _valueIsPlaying = false;
  
  // Debounce/Throttling for seek
  DateTime? _ignoreProgressUntil;
  
  bool _isInitialized = false;
  bool get isInitialized => _isInitialized;

  Stream<FastVideoEvent> get events => _eventStreamController.stream;
  
  // Getters
  Duration get duration => _valueDuration;
  Duration get position => _valuePosition;
  bool get isPlaying => _valueIsPlaying;

  /// Internal method called by the view when created
  void _attach(int viewId) {
    _channel = MethodChannel('native_video_player_channel_$viewId');
    _channel!.setMethodCallHandler(_handleMethodCall);
    _isInitialized = true;
  }

  Future<void> _handleMethodCall(MethodCall call) async {
    if (call.method == 'onEvent') {
      final Map<dynamic, dynamic> args = call.arguments;
      final String event = args['event'];
      switch (event) {
        case 'initialized':
          final durationSec = args['duration'] as int; // seconds
          _valueDuration = Duration(seconds: durationSec);
           _eventStreamController.add(FastVideoEvent(
             type: FastVideoEventType.initialized, 
             duration: _valueDuration
           ));
          break;
        case 'started':
           _valueIsPlaying = true;
           _eventStreamController.add(FastVideoEvent(type: FastVideoEventType.started));
          break;
         case 'paused':
           _valueIsPlaying = false;
           _eventStreamController.add(FastVideoEvent(type: FastVideoEventType.paused));
          break;
        case 'ended':
           _valueIsPlaying = false;
           _eventStreamController.add(FastVideoEvent(type: FastVideoEventType.ended));
          break;
        case 'progress':
          // Ignore progress updates if we recently seeked (to avoid jumping back)
          if (_ignoreProgressUntil != null && DateTime.now().isBefore(_ignoreProgressUntil!)) {
            return;
          }
          final pos = args['position'] as int;
          final dur = args['duration'] as int;
          _valuePosition = Duration(seconds: pos);
          _valueDuration = Duration(seconds: dur); // Ensure duration is fresh
           _eventStreamController.add(FastVideoEvent(
             type: FastVideoEventType.progress,
             position: _valuePosition,
             duration: _valueDuration
           ));
          break;
      }
    } else if (call.method == "updateStats") {
        statsNotifier.value = call.arguments as String;
    } else if (call.method == "updateDecoder") {
        decoderNotifier.value = "Decoder: ${call.arguments}";
    }
  }

  /// Load a new video.
  /// [path] can be a file path or a name (which is searched in Movies dir for backward compatibility).
  Future<void> load(String path) async {
    if (!_isInitialized) return;
    statsNotifier.value = "Loading $path...";
    decoderNotifier.value = "";
    // Reset state on load? Ideally native side sends event, but let's be safe
    _valueIsPlaying = false;
    _valuePosition = Duration.zero;
    _ignoreProgressUntil = null;
    await _channel?.invokeMethod('load', {'path': path});
  }
  
  Future<void> play() async {
    if (!_isInitialized) return;
    // Optimistic update
    _valueIsPlaying = true; 
    await _channel?.invokeMethod('play');
  }

  Future<void> pause() async {
    if (!_isInitialized) return;
    // Optimistic update
    _valueIsPlaying = false; 
    await _channel?.invokeMethod('pause');
  }
  
  /// Set volume (0.0 to 10.0)
  Future<void> setVolume(double volume) async {
    if (!_isInitialized) return;
    await _channel?.invokeMethod('setVolume', {'volume': volume});
  }

  Future<void> seekTo(int seconds) async {
    if (!_isInitialized) return;
    
    // Optimistic update
    int newPos = seconds;
    if (newPos < 0) newPos = 0;
    if (_valueDuration.inSeconds > 0 && newPos > _valueDuration.inSeconds) {
       newPos = _valueDuration.inSeconds;
    }
    _valuePosition = Duration(seconds: newPos);
    
    // Ignore updates for 500ms to allow native player to catch up
    _ignoreProgressUntil = DateTime.now().add(const Duration(milliseconds: 500));
    
    await _channel?.invokeMethod('seekTo', {'position': seconds});
  }

  /// Shift time relative to current position
  /// [seconds] can be positive (forward) or negative (backward)
  Future<void> shiftTime(int seconds) async {
    if (!_isInitialized) return;
    
    // Optimistic update
    int newPos = _valuePosition.inSeconds + seconds;
    if (newPos < 0) newPos = 0;
    if (_valueDuration.inSeconds > 0 && newPos > _valueDuration.inSeconds) {
      newPos = _valueDuration.inSeconds;
    }
    _valuePosition = Duration(seconds: newPos);
    
    // Ignore updates for 500ms to allow native player to catch up
    _ignoreProgressUntil = DateTime.now().add(const Duration(milliseconds: 500));
    
    // Use absolute seekTo instead of relative shiftTime to prevent drift
    await _channel?.invokeMethod('seekTo', {'position': newPos});
  }

  /// Enable or disable video looping
  Future<void> setLooping(bool looping) async {
    if (!_isInitialized) return;
    await _channel?.invokeMethod('setLooping', {'looping': looping});
  }

  void dispose() {
    _channel?.invokeMethod('dispose');
    _eventStreamController.close();
    _isInitialized = false;
  }
}

class FastVideoPlayer extends StatelessWidget {
  final FastVideoPlayerController controller;
  final double? width;
  final double? height;
  final String? initialVideo; // Optional, to load on creation
  final bool showControls;

  const FastVideoPlayer({
    Key? key, 
    required this.controller,
    this.width,
    this.height,
    this.initialVideo,
    this.showControls = true,
  }) : super(key: key);

  @override
  Widget build(BuildContext context) {
    // Use AndroidView for best compatibility with external display/Tv boxes if possible,
    // or PlatformViewLink for better performance with Hybrid Composition.
    // The original code used PlatformViewLink with AndroidViewSurface.
    
    return SizedBox(
      width: width,
      height: height,
      child: PlatformViewLink(
        viewType: 'native_video_player',
        surfaceFactory: (context, controller) {
          return AndroidViewSurface(
            controller: controller as AndroidViewController,
            gestureRecognizers: const <Factory<OneSequenceGestureRecognizer>>{},
            hitTestBehavior: PlatformViewHitTestBehavior.opaque,
          );
        },
        onCreatePlatformView: (params) {
          return PlatformViewsService.initSurfaceAndroidView(
            id: params.id,
            viewType: 'native_video_player',
            layoutDirection: TextDirection.ltr,
            creationParams: {
              'videoName': initialVideo ?? "",
              'showControls': showControls,
            },
            creationParamsCodec: const StandardMessageCodec(),
            onFocus: () {
              params.onFocusChanged(true);
            },
          )
          ..addOnPlatformViewCreatedListener(params.onPlatformViewCreated)
          ..addOnPlatformViewCreatedListener((id) {
             controller._attach(id);
          })
          ..create();
        },
      ),
    );
  }
}
