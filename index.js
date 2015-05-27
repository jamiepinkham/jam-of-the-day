var SpotifyWebApi = require('spotify-web-api-node');
var creds = {
	clientId: process.env.SPOTIFY_CLIENT_ID || "154eb1729d264a469ef79216e8ac5aba",
	clientSecret: process.env.SPOTIFY_CLIENT_SECRET || "6eee5ab7acd2482692c2aedf553377d8"
};
var spotifyApi = new SpotifyWebApi(creds);
var spotifyUser = process.env.SPOTIFY_USERNAME || "jamiepinkham";
var spotifyPlaylistId = process.env.SPOTIFY_PLAYLIST || "1kyph67S6GL8rSvOpeVskS";

var slack = require('slack-notify')(process.env.SLACK_URL || "https://hooks.slack.com/services/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");

var fs = require('fs');
var redis = require('redis');


Date.prototype.isValid = function() {
	// An invalid date object returns NaN for getTime() and NaN is the only
	// object not strictly equal to itself.
	return this.getTime() === this.getTime();
};

var start = false;

function grantClient() {
	spotifyApi.clientCredentialsGrant().then(function(data) {
		console.log('Got new access token, valid for', data.expires_in, 'seconds');
		spotifyApi.setAccessToken(data.access_token);
		start = true;
		setTimeout(grantClient, data.expires_in * 1000);
	}, function(err) {
		console.log('Something went wrong when retrieving an access token', err);
		process.exit(1);
	});
}

var client;
var fetchPlaylist = function() {
		var lastDate;
		var writeLastDate;
		var writeOffset;
		var lastOffset;
		if (process.env.REDISTOGO_URL) {
			console.log("using redis");
			var rtg = require("url").parse(process.env.REDISTOGO_URL);
			client = redis.createClient(rtg.port, rtg.hostname);
			client.auth(rtg.auth.split(":")[1]);
			client.on("error", function(err) {
				console.log("Redis - Error " + err);
			});
			client.get("lastDate", function(err, value) {
				if (!err) {
					lastDate = new Date(value);
				}
			});
			client.get("offset", function(err, value){
				if(!err){
					lastOffset = value;
				}
			});
			writeLastDate = function(date) {
				client.set('lastDate', date);
			};
			writeOffset = function(offset){
				client.set('offset', offset);
			}
		} else {
			console.log("using filesystem");
			var contents = fs.readFileSync('./last_date.txt');
			console.log(contents.toString());
			lastDate = new Date(contents.toString());
			console.log('lastdate isValid ' + lastDate.isValid());
			writeLastDate = function(date) {
				fs.writeFile("./last_date.txt", date, function() {});
			};

		}

		return function() {
			if (!start) {
				return;
			}
			console.log("Last fetched at:", lastDate);
			spotifyApi.getPlaylist(spotifyUser, spotifyPlaylistId, {
				fields: 'tracks.items(added_by.id,added_at,track(name,artists.name,album.name)),name,external_urls.spotify,total',
				offset: lastOffset || 0
			}).then(function(data) {
				for (var i in data.tracks.items) {
					// spotifyApi.getUser(data.tracks.items[i].added_by.id).then(function(userData) {
						var date = new Date(data.tracks.items[i].added_at);
						console.log("track added " + data.tracks.items[i].track.name + " on " + date);
						if (date > lastDate) {
							post(data.name, data.external_urls.spotify, data.tracks.items[i].added_by.id, data.tracks.items[i].track.name, data.tracks.items[i].track.artists);
							lastDate = date;
							writeLastDate(lastDate);
						}
						if(data.total > data.tracks.count)
						{
							var offset = data.total - data.tracks;
							
						}
						
					// }, function(err) {
						// console.log('something went wrong', err);
					// });
				}
			}, function(err) {
				console.log('Something went wrong!', err);
			});
		};
	};

slack.onError = function(err) {
	console.log('API error:', err);
};
var slacker = slack.extend({
	username: 'spotify-playlist',
	icon_url: 'http://icons.iconarchive.com/icons/xenatt/the-circle/256/App-Spotify-icon.png',
	unfurl_media: false
});

function post(list_name, list_url, added_by, trackname, artists) {
	var text = 'New track added by ' + added_by + ' - *' + trackname + '* by ' + artists[0].name + ' in list <' + list_url + '|' + list_name + '>';
	console.log(text);
	slacker({
		text: text
	});
}

grantClient();
setInterval(fetchPlaylist(), 1000 * 10);
