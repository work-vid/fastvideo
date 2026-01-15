import 'package:flutter/material.dart';
import 'package:permission_handler/permission_handler.dart';
import 'package:fastvideo_flutter/fast_video_player.dart'; // Import from plugin

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
        colorScheme: ColorScheme.fromSeed(seedColor: const Color.fromARGB(255, 144, 142, 146)),
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
  final FastVideoPlayerController _controller = FastVideoPlayerController();
  bool _permissionGranted = false;
  
  // UI State
  String _eventLog = "";
  double _volume = 5.0; // 0-10
  double _progress = 0.0;
  double _duration = 1.0;
  
  // New features state
  bool _looping = false;
  bool _showControls = true;

  @override
  void initState() {
    super.initState();
    _requestPermission();
    _listenToEvents();
  }
  
  void _listenToEvents() {
    _controller.events.listen((event) {
      if (mounted) {
        setState(() {
          if (event.type == FastVideoEventType.progress) {
            _progress = event.position!.inSeconds.toDouble();
            _duration = event.duration!.inSeconds.toDouble();
          } else {
            _eventLog = "$event";
            print(_eventLog);
            if (event.type == FastVideoEventType.initialized) {
              _duration = event.duration!.inSeconds.toDouble();
            }
          }
        });
      }
    });
  }

  Future<void> _requestPermission() async {
    var status = await Permission.storage.request();
    if (status.isGranted) {
      setState(() {
        _permissionGranted = true;
      });
    } else {
      var manageStatus = await Permission.manageExternalStorage.request();
      if (manageStatus.isGranted) {
        setState(() {
          _permissionGranted = true;
        });
      }
    }
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.black,
      body: Stack(
        children: [
          if (_permissionGranted)
            // Rebuild player when showControls changes to update creation param
            KeyedSubtree(
              // Using ValueKey ensures the widget tree is rebuilt when showControls changes
              // but we need to verify if the underlying PlatformView is destroyed/recreated.
              // In this implementation it should be, as KeyedSubtree propagates identity.
              key: ValueKey(_showControls),
              child: FastVideoPlayer(
                controller: _controller,
                initialVideo: "test4k", // Default video
                showControls: _showControls,
              ),
            ),
          
          // Debug Overlay
          Positioned(
            top: 40,
            left: 16,
            right: 16,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                ValueListenableBuilder<String>(
                  valueListenable: _controller.statsNotifier,
                  builder: (ctx, val, _) => Text(
                    val,
                    style: const TextStyle(color: Colors.yellow, fontSize: 12),
                  ),
                ),
                ValueListenableBuilder<String>(
                  valueListenable: _controller.decoderNotifier,
                  builder: (ctx, val, _) => Text(
                    val,
                    style: const TextStyle(color: Colors.cyan, fontSize: 12),
                  ),
                ),
                Text(
                  "Event: $_eventLog",
                  style: const TextStyle(color: Colors.green, fontSize: 12),
                ),
              ],
            ),
          ),

          // Controls UI
          Positioned(
            bottom: 30,
            left: 0,
            right: 0,
            child: Container(
              color: Colors.black54,
              padding: const EdgeInsets.all(8),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  // Progress Bar
                  Row(
                    children: [
                      Text("${_progress.toInt()}s", style: const TextStyle(color: Colors.white)),
                      Expanded(
                        child: Slider(
                          value: _progress.clamp(0, _duration),
                          min: 0,
                          max: _duration > 0 ? _duration : 1, // Avoid divide by zero
                          onChanged: (val) {
                            _controller.seekTo(val.toInt());
                          },
                        ),
                      ),
                      Text("${_duration.toInt()}s", style: const TextStyle(color: Colors.white)),
                    ],
                  ),

                  // Toggles
                  Row(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                        Row(
                           children: [
                               Checkbox(
                                   value: _looping,
                                   onChanged: (val) {
                                       setState(() { _looping = val ?? false; });
                                       _controller.setLooping(_looping);
                                   },
                                   fillColor: MaterialStateProperty.all(Colors.white),
                                   checkColor: Colors.black,
                               ),
                               const Text("Loop", style: TextStyle(color: Colors.white)),
                           ], 
                        ),
                        const SizedBox(width: 20),
                        Row(
                           children: [
                               Checkbox(
                                   value: _showControls,
                                   onChanged: (val) {
                                       setState(() { _showControls = val ?? true; });
                                   },
                                   fillColor: MaterialStateProperty.all(Colors.white),
                                   checkColor: Colors.black,
                               ),
                               const Text("Native Controls", style: TextStyle(color: Colors.white)),
                           ], 
                        ),
                    ],
                  ),

                  // Buttons
                  SingleChildScrollView(
                    scrollDirection: Axis.horizontal,
                    child: Row(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        IconButton(
                          icon: const Icon(Icons.play_arrow, color: Colors.white),
                          onPressed: () => _controller.play(),
                        ),
                        IconButton(
                          icon: const Icon(Icons.pause, color: Colors.white),
                          onPressed: () => _controller.pause(),
                        ),
                        const SizedBox(width: 10),
                        const Icon(Icons.volume_up, color: Colors.white, size: 20),
                        SizedBox(
                          width: 100,
                          child: Slider(
                            value: _volume,
                            min: 0,
                            max: 10,
                            onChanged: (val) {
                              setState(() {
                                _volume = val;
                              });
                              _controller.setVolume(val);
                            },
                          ),
                        ),
                      ],
                    ),
                  ),

                  // Load Buttons
                  SingleChildScrollView(
                    scrollDirection: Axis.horizontal,
                    child: Row(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        TextButton(
                          onPressed: () => _controller.load('test1080'),
                          child: const Text('1080p'),
                        ),
                        TextButton(
                          onPressed: () => _controller.load('test2k'),
                          child: const Text('2K'),
                        ),
                        TextButton(
                          onPressed: () => _controller.load('test4k'),
                          child: const Text('4K'),
                        ),
                        TextButton(
                          onPressed: _showCustomDialog,
                          child: const Text('Custom'),
                        ),
                      ],
                    ),
                  )
                ],
              ),
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
          title: const Text('Enter Filename / Path'),
          content: TextField(
            onChanged: (value) {
              filename = value;
            },
            decoration: const InputDecoration(hintText: "video.mp4 or /path/to/video"),
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
                  _controller.load(filename!);
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
