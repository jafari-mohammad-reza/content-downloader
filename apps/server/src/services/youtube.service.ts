import axios, { AxiosResponse } from 'axios';
import createHttpError from 'http-errors';
import {
  catchError,
  concatMap,
  defer,
  forkJoin,
  from,
  map,
  Observable,
  switchMap,
  toArray,
} from 'rxjs';
import { v4 as uuidv4 } from 'uuid';
import ytdl, { videoInfo } from 'ytdl-core';
import { DownloadedAudio } from '../interfaces/download.interface';
import { youtubePlayList } from '../interfaces/youtube-playlist.interface';
import { convertStreamToSong, zipDownloadedAudios } from './convertor.service';
import { getCachedPlaylistVideos, getCachedVideo } from './redis.service';

export function getYoutubeContentInfo(link: string): Observable<videoInfo> {
  process.env.YTDL_NO_UPDATE = 'true';

  return defer(() => ytdl.getInfo(link)).pipe(
    catchError((err) => {
      throw createHttpError(err);
    }),
  );
}

// This function downloads a single audio from a given link
export const downloadSingleAudio = (
  link: string,
  isHighQuality: boolean,
): Observable<DownloadedAudio> => {
  // Select video quality based on isHighQuality value
  const quality = isHighQuality ? 'highestaudio' : 'lowestaudio';

  return getCachedVideo(link).pipe(
    // Switch to inner observable to handle downloading and converting
    switchMap((info) => {
      // Download the audio stream using ytdl library
      const stream = ytdl.downloadFromInfo(info, {
        filter: 'audioonly',
        quality,
      });

      // Generate unique file path based on selected format
      const filePath = `${__dirname}/../../public/${uuidv4()}.${
        isHighQuality ? 'flac' : 'mp3'
      }`;

      // Save video title and channel name for later use
      const title = info.videoDetails.title;
      const channelName = info.videoDetails.ownerChannelName;

      // Convert downloaded video stream to either FLAC or MP3 format
      return convertStreamToSong(
        isHighQuality,
        stream,
        filePath,
        channelName,
        title,
      );
    }),
  );
};

/**
 * Downloads audio files from a playlist and archives them into a zip file.
 *
 * @param {string} link - URL of the YouTube playlist.
 * @param {boolean} isHighQuality - Whether to download high quality audio or not.
 * @param {string} album_name - Name of the directory to be created and archived.
 * @returns {Observable<string>} - Observable that emits the path of the zip file when complete.
 */
export function downloadAudioFromPlaylist(
  link: string,
  isHighQuality: boolean,
  album_name: string,
): Observable<string> {
  return getCachedPlaylistVideos(link).pipe(
    // Obtains an array of video URLs from the playlist cache
    switchMap((links) =>
      from(links).pipe(
        // Downloads each audio file sequentially
        concatMap((link) => downloadSingleAudio(link, isHighQuality)),
        toArray(),
      ),
    ),
    zipDownloadedAudios(isHighQuality, album_name),
  );
}

//A function to get YouTube playlist information
//Returns an observable that emits the response of a GET request to the YouTube API
export function getPlaylistInfo(link: string): Observable<AxiosResponse> {
  //Extract the playlist id from the link
  const playlistId = getPlaylistId(link);
  //Get the api key from environment variables
  const apiKey = process.env.YT_API_KEY!;
  //The url to make the http GET request
  const url = `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&maxResults=50&playlistId=${playlistId}&key=${apiKey}`;

  return from(axios.get(url)).pipe(map((response) => response));
}

//A function to get URLs for all items in a YouTube playlist
export function getPlaylistItemsUrls(link: string): Observable<string[]> {
  //Use the getPlaylistInfo function to get the playlist information, and switchMap allows us to chain another observable
  return getPlaylistInfo(link).pipe(
    switchMap((playlist) => {
      //Extract all video ids from each item in the playlist
      const itemIds = playlist.data.items.map(
        (item: youtubePlayList.Item) => item.snippet.resourceId.videoId,
      );
      //Transforms every video id into an observable for the cached video's url
      const videoUrlObservables = itemIds.map((itemId: string) =>
        getCachedVideo(itemId).pipe(
          map((value) => value.videoDetails.video_url),
          catchError((err) => {
            //Catch errors if any occur during transforming video ids to urls
            throw createHttpError(err);
          }),
        ),
      );
      /* Uses forkJoin to subscribe to all video urls, which only emits after all passed observables complete.
            Then it returns transformed urls and filters out any empty ones */
      return forkJoin(videoUrlObservables).pipe(
        map((urls: any) => urls.filter((url: string) => url !== '')),
        catchError((err) => {
          //Catch errors for any network failure or exceptions thrown by the underlying server-side library
          throw createHttpError(err);
        }),
      );
    }),
    catchError((err) => {
      //Catches any errors occurring while obtaining playlist information using the getPlaylistInfo function
      throw createHttpError(err);
    }),
  );
}

function getPlaylistId(url: string): string {
  const playlistId = url.match(/^[^#\&\?]*list=([^#\&\?]+)/);

  if (playlistId) {
    return playlistId[1];
  } else {
    throw createHttpError('Invalid YouTube playlist URL');
  }
}
