Tinytest.add("core - getIp - direct connection", function(test) {
  var remoteAddress = "1.1.1.1";
  var ip = Firewall._getIp({}, remoteAddress);
  test.equal(ip, remoteAddress);
});

Tinytest.add("core - getIp - behind a proxy", function(test) {
  var headers = {
    'x-forwarded-for': '1.1.1.1'
  };
  var ip = Firewall._getIp(headers);
  test.equal(ip, headers['x-forwarded-for']);
});

Tinytest.add("core - getIp - behind a proxy-chain", function(test) {
  var expectedIp = "1.1.1.1";
  var headers = {
    'x-forwarded-for': expectedIp + ", some other"
  };
  var ip = Firewall._getIp(headers);
  test.equal(ip, expectedIp);
});

Tinytest.add("core - stats - ensure stats", function(test) {
  var type = Random.id();
  var key = Random.id();
  Firewall._ensureStats(type, key, 100);

  test.equal(Firewall.stats[type][key].count, 0);
  test.isTrue(Firewall.stats[type][key].startedAt > 0);

  Meteor._sleepForMs(150);
  test.equal(Firewall.stats[type][key], undefined);
});

Tinytest.add("core - stats - increment stats", function(test) {
  var type = Random.id();
  var key = Random.id();
  Firewall._ensureStats(type, key, 100);

  Firewall._incStat(type, key);
  test.equal(Firewall.stats[type][key].count, 1);

  Firewall._incStat(type, key);
  test.equal(Firewall.stats[type][key].count, 2);
});

Tinytest.add("core - stats - get stats", function(test) {
  var type = Random.id();
  var key = Random.id();
  Firewall._ensureStats(type, key, 100);
  Firewall._incStat(type, key);
  test.equal(Firewall._getStat(type, key).count, 1);
});

Tinytest.add("core - stats - rate exceeds - no such stat key", function(test) {
  var type = Random.id();
  var key = Random.id();
  test.isFalse(Firewall._rateExceeds(type, key, 200));
});

Tinytest.add("core - stats - rate exceeds - exceeds", function(test) {
  var type = Random.id();
  var key = Random.id();
  Firewall._ensureStats(type, key);
  Firewall.stats[type][key].count = 500;
  Meteor._sleepForMs(1100);
  test.isTrue(Firewall._rateExceeds(type, key, 200));
});

Tinytest.add("core - stats - rate exceeds - not exceeds", function(test) {
  var type = Random.id();
  var key = Random.id();
  Firewall._ensureStats(type, key);
  Firewall.stats[type][key].count = 100;
  Meteor._sleepForMs(1100);
  test.isFalse(Firewall._rateExceeds(type, key, 200));
});

Tinytest.add("core - IP - block IP", function(test) {
  var ip = '1.1.1.1';
  test.equal(Firewall._isBlocked(ip), false);

  Firewall._blockIpFor(ip, 100);
  test.equal(Firewall._isBlocked(ip), true);

  Meteor._sleepForMs(110);
  test.equal(Firewall._isBlocked(ip), false);
});

Tinytest.add("core - human - add human", function(test) {
  var token = Random.id();
  test.equal(Firewall._isValidHuman(token), false);

  Firewall._addHumanFor(token, 100);
  test.equal(Firewall._isValidHuman(token), true);

  Meteor._sleepForMs(110);
  test.equal(Firewall._isValidHuman(token), false);
});

Tinytest.add("core - human - delete human", function(test) {
  var token = Random.id();
  Firewall._addHumanFor(token, 1000 * 5);
  test.equal(Firewall._isValidHuman(token), true);

  Firewall._deleteHuman(token);
  test.equal(Firewall._isValidHuman(token), false);
});

Tinytest.add("core - logic - when IP rate exceeds", function(test) {
  var ip = Random.id(), session = Random.id(), human = Random.id();

  var newFields = {
    _rateExceeds: sinon.stub(),
    _blockIpFor: sinon.stub()
  };
  newFields._rateExceeds.returns(true);

  WithNew(Firewall, newFields, function() {
    var blocked = Firewall._updateStats(ip, session, human);
    test.equal(blocked, true);
    test.equal(newFields._blockIpFor.callCount, 1);
  });
});

Tinytest.add("core - logic - when human rate exceeds", function(test) {
  var ip = Random.id(), session = Random.id(), human = Random.id();

  var newFields = {
    _rateExceeds: sinon.stub(),
    _blockIpFor: sinon.stub(),
    _isValidHuman: sinon.stub(),
    _deleteHuman: sinon.stub()
  };
  newFields._rateExceeds
    .onCall(0).returns(false) // not exceeds for ip
    .onCall(1).returns(true); // exceeds for human

  newFields._isValidHuman.returns(true);

  WithNew(Firewall, newFields, function() {
    var blocked = Firewall._updateStats(ip, session, human);
    test.equal(blocked, true);
    test.equal(newFields._deleteHuman.callCount, 1);
  });
});

Tinytest.add("core - logic - IP rate exceeds, but not for the human", function(test) {
  var ip = Random.id(), session = Random.id(), human = Random.id();

  var newFields = {
    _rateExceeds: sinon.stub(),
    _blockIpFor: sinon.stub(),
    _isValidHuman: sinon.stub(),
    _deleteHuman: sinon.stub()
  };
  newFields._rateExceeds
    .onCall(0).returns(true) // exceeds for ip
    .onCall(1).returns(false); // not exceeds for human

  newFields._isValidHuman.returns(true);

  WithNew(Firewall, newFields, function() {
    var blocked = Firewall._updateStats(ip, session, human);
    test.equal(blocked, false);
    test.equal(newFields._deleteHuman.callCount, 0);
  });
});

Tinytest.add("core - logic - allow only for humans", function(test) {
  var ip = Random.id(), session = Random.id(), human = Random.id();

  var newFields = {
    _rateExceeds: sinon.stub(),
    _blockIpFor: sinon.stub(),
    _isValidHuman: sinon.stub()
  };
  newFields._rateExceeds
    .onCall(0).returns(false); // not exceeds for ip

  newFields._isValidHuman.returns(false);

  WithNew(Config, {onlyForHumans: true}, function() {
    WithNew(Firewall, newFields, function() {
      var blocked = Firewall._updateStats(ip, session, human);
      test.equal(blocked, true);
    });
  });
});