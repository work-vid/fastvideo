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
  
  bool _isInitialized = false;
  bool get isInitialized => _isInitialized;

  Stream<FastVideoEvent> get events => _eventStreamController.stream;

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
          final duration = args['duration'] as int; // seconds
           _eventStreamController.add(FastVideoEvent(
             type: FastVideoEventType.initialized, 
             duration: Duration(seconds: duration)
           ));
          break;
        case 'started':
           _eventStreamController.add(FastVideoEvent(type: FastVideoEventType.started));
          break;
         case 'paused':
           _eventStreamController.add(FastVideoEvent(type: FastVideoEventType.paused));
          break;
        case 'ended':
           _eventStreamController.add(FastVideoEvent(type: FastVideoEventType.ended));
          break;
        case 'progress':
          final pos = args['position'] as int;
          final dur = args['duration'] as int;
           _eventStreamController.add(FastVideoEvent(
             type: FastVideoEventType.progress,
             position: Duration(seconds: pos),
             duration: Duration(seconds: dur)
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
    await _channel?.invokeMethod('load', {'path': path});
  }
  
  Future<void> play() async {
    if (!_isInitialized) return;
    await _channel?.invokeMethod('play');
  }

  Future<void> pause() async {
    if (!_isInitialized) return;
    await _channel?.invokeMethod('pause');
  }
  
  /// Set volume (0.0 to 10.0)
  Future<void> setVolume(double volume) async {
    if (!_isInitialized) return;
    await _channel?.invokeMethod('setVolume', {'volume': volume});
  }

  Future<void> seekTo(int seconds) async {
    if (!_isInitialized) return;
    await _channel?.invokeMethod('seekTo', {'position': seconds});
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
