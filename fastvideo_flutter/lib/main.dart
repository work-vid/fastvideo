import 'package:flutter/foundation.dart';
import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:permission_handler/permission_handler.dart';

void main() {
  runApp(const MyApp());
}

class MyApp extends StatelessWidget {
  const MyApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'FastVideo Flutter',
      theme: ThemeData(
        colorScheme: ColorScheme.fromSeed(seedColor: Colors.deepPurple),
        useMaterial3: true,
      ),
      home: const VideoPlayerScreen(),
    );
  }
}

class VideoPlayerScreen extends StatefulWidget {
  const VideoPlayerScreen({super.key});

  @override
  State<VideoPlayerScreen> createState() => _VideoPlayerScreenState();
}

class _VideoPlayerScreenState extends State<VideoPlayerScreen> {
  bool _permissionGranted = false;
  MethodChannel? _channel;

  @override
  void initState() {
    super.initState();
    _requestPermission();
  }

  Future<void> _requestPermission() async {
    var status = await Permission.storage.request();
    if (status.isGranted) {
       setState(() { _permissionGranted = true; });
    } else {
      var manageStatus = await Permission.manageExternalStorage.request();
      if (manageStatus.isGranted) {
         setState(() { _permissionGranted = true; });
      }
    }
  }

  String _statsText = "Loading stats...";
  String _decoderText = "";

  void _onPlatformViewCreated(int id) {
    _channel = MethodChannel('native_video_player_channel_$id');
    _channel?.setMethodCallHandler((call) async {
      if (call.method == "updateStats") {
        setState(() {
          _statsText = call.arguments as String;
        });
      }
      if (call.method == "updateDecoder") {
         setState(() {
          _decoderText = "Decoder: ${call.arguments}";
        });
      }
    });
  }

  int _viewId = 0;
  String _currentVideo = "test4k";

  Future<void> _playVideo(String name) async {
    // Instead of calling method channel, we trigger a REBUILD of the platform view.
    // This matches the Native App's "key()" strategy which destroys the old surface.
    setState(() {
      _viewId++;
      _currentVideo = name;
      _statsText = "Loading $name...";
      _decoderText = "";
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.black,
      body: Stack(
        children: [
          if (_permissionGranted)
            Positioned.fill(
              // Key ensures the widget tree destroys the old PlatformView
              key: ValueKey(_viewId), 
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
                    viewType: 'native_video_player', // Match registered factory name
                    layoutDirection: TextDirection.ltr,
                    // Pass the video name to the new view
                    creationParams: {'videoName': _currentVideo}, 
                    creationParamsCodec: const StandardMessageCodec(),
                    onFocus: () {
                      params.onFocusChanged(true);
                    },
                  )
                  ..addOnPlatformViewCreatedListener(params.onPlatformViewCreated)
                  ..addOnPlatformViewCreatedListener(_onPlatformViewCreated)
                  ..create();
                },
              ),
            ),
          
          // Debug Overlay
          Positioned(
            top: 40,
            left: 16,
            child: Container(
              padding: const EdgeInsets.all(8),
              color: Colors.black54,
              child: Text(
                "$_statsText\n$_decoderText",
                style: const TextStyle(color: Colors.yellow, fontSize: 12),
              ),
            ),
          ),

          // Resolution Switching UI
          Positioned(
            bottom: 50,
            left: 0,
            right: 0,
            child: Row(
              mainAxisAlignment: MainAxisAlignment.spaceEvenly,
              children: [
                FilledButton(
                  onPressed: () => _playVideo('test1080'),
                  child: const Text('1080p'),
                ),
                FilledButton(
                  onPressed: () => _playVideo('test2k'),
                  child: const Text('2K'),
                ),
                FilledButton(
                  onPressed: () => _playVideo('test4k'),
                  child: const Text('4K'),
                ),
                FilledButton(
                  onPressed: _showCustomDialog,
                  child: const Text('Custom'),
                ),
              ],
            ),
          ),
          
          if (!_permissionGranted)
            Center(
              child: ElevatedButton(
                onPressed: _requestPermission,
                child: const Text('Grant Storage Permission'),
              ),
            ),
        ],
      ),
    );
  }

  Future<void> _showCustomDialog() async {
    String? filename;
    return showDialog<void>(
      context: context,
      builder: (BuildContext context) {
        return AlertDialog(
          title: const Text('Enter Filename'),
          content: TextField(
            onChanged: (value) {
              filename = value;
            },
            decoration: const InputDecoration(hintText: "video.mp4"),
          ),
          actions: <Widget>[
            TextButton(
              child: const Text('Cancel'),
              onPressed: () {
                Navigator.of(context).pop();
              },
            ),
            TextButton(
              child: const Text('Play'),
              onPressed: () {
                if (filename != null && filename!.isNotEmpty) {
                  _playVideo(filename!);
                }
                Navigator.of(context).pop();
              },
            ),
          ],
        );
      },
    );
  }
}
