# ghost-darklyd

Example of controlling gh-ost schema migrations at runtime using LaunchDarkly.

A small daemon (ghost-darklyd) is started when gh-ost starts via a hook in ghost-hooks.d. 

Updates to starting with `ghost-` are listened for and converted into commands sent to the gh-ost admin socket. For example, if you create a flag called `ghost-chunk-size`, you can dynamically change the chunk sized used when copying by updating the flag.

An example migration is included in `example/add-col-expiry.sh`. Bring the sample database up using `docker-compose up --detach`. You can run the example setting the following env variables:

```sh
export LD_SDK_KEY=<your sdk key>
#optional, trigger url that will be called when the migration suceeds
# for example, turn a flag on after the column is added
export GHOST_SUCCESS_URL=<launchdarkly trigger url>
```
Then start the example

```sh
bash example/add-col-expiry.sh --execute
```

Logs will be stored in `/tmp/launchdarkly-ghost.log`. You can complete the cutover by creating a flag called `ghost-allow-cutover` and having it return `true`. 
