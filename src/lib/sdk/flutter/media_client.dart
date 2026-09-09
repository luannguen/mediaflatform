/// Media Platform Flutter SDK
/// Enterprise DAM Client and Responsive Image Widget for Flutter Applications
library media_platform;

import 'dart:convert';
import 'dart:io';
import 'package:http/http.dart' as http;
import 'package:flutter/material.dart';

/// Configuration and API Client for Media Platform
class MediaPlatformClient {
  final String baseUrl;
  final String? apiKey;

  MediaPlatformClient({
    required this.baseUrl,
    this.apiKey,
  });

  /// Generate a CDN transformed URL for an asset
  String getDeliveryUrl(
    String assetId, {
    int? width,
    int? height,
    int? quality,
    String? format,
    String? fit,
    double? focalX,
    double? focalY,
  }) {
    final cleanBase = baseUrl.replaceAll(RegExp(r'/+$'), '');
    final queryParams = <String, String>{};

    if (width != null) queryParams['width'] = width.toString();
    if (height != null) queryParams['height'] = height.toString();
    if (quality != null) queryParams['quality'] = quality.toString();
    if (format != null) queryParams['format'] = format;
    if (fit != null) queryParams['fit'] = fit;
    if (focalX != null) queryParams['focal_x'] = focalX.toStringAsFixed(2);
    if (focalY != null) queryParams['focal_y'] = focalY.toStringAsFixed(2);

    final uri = Uri.parse('$cleanBase/api/v1/delivery/$assetId');
    if (queryParams.isNotEmpty) {
      return uri.replace(queryParameters: queryParams).toString();
    }
    return uri.toString();
  }

  /// Get HLS Master Playlist URL for video streaming
  String getVideoHlsUrl(String assetId) {
    final cleanBase = baseUrl.replaceAll(RegExp(r'/+$'), '');
    return '$cleanBase/api/v1/delivery/video/$assetId/master.m3u8';
  }

  /// Get Animated 3s trailer preview URL
  String getVideoTrailerUrl(String assetId) {
    final cleanBase = baseUrl.replaceAll(RegExp(r'/+$'), '');
    return '$cleanBase/api/v1/delivery/video/$assetId/trailer.webp';
  }

  /// Fetch list of assets with pagination
  Future<Map<String, dynamic>> fetchAssets({
    int limit = 50,
    int offset = 0,
    String? collectionId,
  }) async {
    final cleanBase = baseUrl.replaceAll(RegExp(r'/+$'), '');
    final uri = Uri.parse('$cleanBase/api/v1/assets').replace(queryParameters: {
      'limit': limit.toString(),
      'offset': offset.toString(),
      if (collectionId != null) 'collection_id': collectionId,
    });

    final headers = <String, String>{
      'Content-Type': 'application/json',
      if (apiKey != null) 'Authorization': 'Bearer $apiKey',
    };

    final response = await http.get(uri, headers: headers);
    if (response.statusCode >= 200 && response.statusCode < 300) {
      return jsonDecode(response.body) as Map<String, dynamic>;
    } else {
      throw Exception('Failed to fetch assets: ${response.statusCode} - ${response.body}');
    }
  }

  /// Direct multipart upload of local media file
  Future<Map<String, dynamic>> uploadAsset(
    File file, {
    String? collectionId,
    List<String>? tags,
  }) async {
    final cleanBase = baseUrl.replaceAll(RegExp(r'/+$'), '');
    final uri = Uri.parse('$cleanBase/api/v1/uploads/direct');

    final request = http.MultipartRequest('POST', uri);
    if (apiKey != null) {
      request.headers['Authorization'] = 'Bearer $apiKey';
    }

    if (collectionId != null) {
      request.fields['collection_id'] = collectionId;
    }
    if (tags != null && tags.isNotEmpty) {
      request.fields['tags'] = jsonEncode(tags);
    }

    final multipartFile = await http.MultipartFile.fromPath('file', file.path);
    request.files.add(multipartFile);

    final streamedResponse = await request.send();
    final response = await http.Response.fromStream(streamedResponse);

    if (response.statusCode >= 200 && response.statusCode < 300) {
      return jsonDecode(response.body) as Map<String, dynamic>;
    } else {
      throw Exception('Asset upload failed: ${response.statusCode} - ${response.body}');
    }
  }
}

/// Flutter Responsive Media Platform Image Widget
class MediaImage extends StatelessWidget {
  final String assetId;
  final MediaPlatformClient client;
  final double? width;
  final double? height;
  final int? quality;
  final String format;
  final String fit;
  final double? focalX;
  final double? focalY;
  final BoxFit boxFit;
  final Color placeholderColor;
  final Widget? placeholder;
  final Widget? errorWidget;

  const MediaImage({
    Key? key,
    required this.assetId,
    required this.client,
    this.width,
    this.height,
    this.quality = 80,
    this.format = 'webp',
    this.fit = 'cover',
    this.focalX,
    this.focalY,
    this.boxFit = BoxFit.cover,
    this.placeholderColor = const Color(0xFF1E293B),
    this.placeholder,
    this.errorWidget,
  }) : super(key: key);

  @override
  Widget build(BuildContext context) {
    final url = client.getDeliveryUrl(
      assetId,
      width: width?.toInt(),
      height: height?.toInt(),
      quality: quality,
      format: format,
      fit: fit,
      focalX: focalX,
      focalY: focalY,
    );

    final headers = <String, String>{
      if (client.apiKey != null) 'Authorization': 'Bearer ${client.apiKey}',
    };

    return Container(
      width: width,
      height: height,
      color: placeholderColor,
      child: Image.network(
        url,
        headers: headers,
        fit: boxFit,
        loadingBuilder: (context, child, loadingProgress) {
          if (loadingProgress == null) return child;
          return placeholder ??
              Center(
                child: CircularProgressIndicator(
                  value: loadingProgress.expectedTotalBytes != null
                      ? loadingProgress.cumulativeBytesLoaded /
                          loadingProgress.expectedTotalBytes!
                      : null,
                  strokeWidth: 2.0,
                  color: const Color(0xFF8B5CF6),
                ),
              );
        },
        errorBuilder: (context, error, stackTrace) {
          return errorWidget ??
              const Center(
                child: Icon(
                  Icons.broken_image_outlined,
                  color: Color(0xFF64748B),
                  size: 28,
                ),
              );
        },
      ),
    );
  }
}
